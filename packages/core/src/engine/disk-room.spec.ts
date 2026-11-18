/**
 * The disk nearly full (task 12.3, board « Quand quelque chose casse », « Disque »): said before the memory of the
 * conversation is saved — how much is free, on which drive, and the oldest memories to let go to make room.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_ENDPOINT, createAgentHandler } from '../agent/handler.js';
import { createCore, type Core } from '../api.js';
import { writeFakeGguf, type FakeGgufOptions } from '../testing/fake-gguf.js';

const cores: Core[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop().catch(() => undefined);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
});

async function managed(free: { bytes: number | null }, gguf: FakeGgufOptions = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bp-disk-room-'));
  dirs.push(dataDir);
  const models = join(dataDir, 'models');
  await mkdir(models, { recursive: true });
  const model = join(models, 'gemma-4-test.gguf');
  await writeFakeGguf(model, gguf);
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const core = createCore({
    dataDir,
    env: {},
    llamaCommand: [process.execPath, fileURLToPath(new URL('../testing/fake-llama-bin.mjs', import.meta.url))],
    port,
    modelRoots: [{ dir: models, source: 'custom' }],
    gpuMemory: async () => 24 * 1024 ** 3,
    freeDiskBytes: async () => free.bytes,
    llamaReleases: null,
    logger: () => undefined,
  });
  cores.push(core);
  await core.loadModel(model);
  const handler = createAgentHandler(core);
  const say = async (conversation: string, text: string): Promise<void> => {
    const response = await handler(
      new Request(`${AGENT_ENDPOINT}/c/${conversation}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, messageId: `m-${conversation}`, request: { messages: [{ role: 'user', content: text }], modelId: '' }, clientTools: [] }),
      }),
    );
    await response.text();
  };
  return { core, say };
}

describe('the disk nearly full', { timeout: 60_000 }, () => {
  it('names the oldest memory to let go so that the conversation in the engine can be saved', async () => {
    const free = { bytes: null as number | null };
    const { core, say } = await managed(free);
    await say('first', 'Bonjour');
    // A second conversation takes the slot: the first one's memory is saved.
    await say('second', 'Bonsoir');
    expect(await core.diskCheck('second')).toBeNull();
    free.bytes = 1024;
    const check = await core.diskCheck('second');
    expect(check).toMatchObject({ freeBytes: 1024, release: ['first'] });
    expect(check!.drive.length).toBeGreaterThan(0);
    expect(check!.needBytes).toBeGreaterThan(0);
  });

  it('counts what a memory of this model really takes on disk, not only its full-attention layers (review 12)', async () => {
    const free = { bytes: null as number | null };
    // A model whose full-attention layers weigh little a token: its saved states weigh more (the sliding windows,
    // llama.cpp's checkpoints), as Gemma 4's do.
    const { core, say } = await managed(free, { blockCount: 2, headCountKv: 1, embeddingLength: 256 });
    await say('first', 'Bonjour');
    await say('second', 'Bonsoir, et encore une phrase de plus pour faire des jetons');
    const rows = await core.conversations.memory();
    const first = rows.find((row) => row.id === 'first')!;
    const second = rows.find((row) => row.id === 'second')!;
    // What a saved state of this model weighs a token, measured on the disk.
    const measured = first.bytes! / first.tokens;
    free.bytes = 1024;
    const check = await core.diskCheck('second');
    expect(check!.needBytes).toBeGreaterThanOrEqual(Math.floor(measured * second.tokens));
  });
});
