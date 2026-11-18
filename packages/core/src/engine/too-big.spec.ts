/**
 * A model too big for the card (task 12.3, board « Quand quelque chose casse », « Avant de charger »): the core
 * refuses the load before anything is launched, saying what it needs and what the card has; nothing runs.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, type Core } from '../api.js';
import { ModelTooBigError } from '../failures.js';
import { writeFakeGguf } from '../testing/fake-gguf.js';

const cores: Core[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop().catch(() => undefined);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
});

async function managed(gpuBytes: number) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bp-too-big-'));
  dirs.push(dataDir);
  const models = join(dataDir, 'models');
  await mkdir(models, { recursive: true });
  const model = join(models, 'gemma-4-test.gguf');
  await writeFakeGguf(model);
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
    gpuMemory: async () => gpuBytes,
    llamaReleases: null,
    logger: () => undefined,
  });
  cores.push(core);
  return { core, model };
}

describe('a model too big for the card', () => {
  it('is refused before anything is launched, its figures said', async () => {
    const { core, model } = await managed(1024 * 1024);
    const refused = await core.loadModel(model).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ModelTooBigError);
    expect(refused).toMatchObject({ gpuBytes: 1024 * 1024 });
    expect((refused as ModelTooBigError).neededBytes).toBeGreaterThan(1024 * 1024);
    expect((await core.engineState()).status).toBe('stopped');
  });

  it('a model that fits loads as before', async () => {
    const { core, model } = await managed(24 * 1024 ** 3);
    expect((await core.loadModel(model)).status).toBe('ready');
  });
});
