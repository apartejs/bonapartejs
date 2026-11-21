/**
 * A conversation changes provider between two turns (task 9.3): to a service, it goes there without its memory —
 * the built-in engine's stays saved; back to the built-in engine, it is rendered again for its model, the
 * service's turns included, as a change of model is (task 7.4).
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, type Core } from '../api.js';
import { openJournal } from '../journal/journal.js';
import type { SecretStore } from '../providers/secrets.js';
import { writeFakeGguf } from '../testing/fake-gguf.js';
import { startFakeOpenAIServer, type FakeOpenAIServer } from '../testing/fake-openai-server.js';
import { AGENT_ENDPOINT, createAgentHandler } from './handler.js';

const BIN = fileURLToPath(new URL('../testing/fake-llama-bin.mjs', import.meta.url));
const dirs: string[] = [];
const cores: Core[] = [];
const services: FakeOpenAIServer[] = [];

afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop().catch(() => undefined);
  for (const service of services.splice(0)) await service.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

const vault = (): SecretStore => {
  const held = new Map<string, string>();
  return { get: async (n) => held.get(n), set: async (n, v) => void held.set(n, v), delete: async (n) => void held.delete(n), has: async (n) => held.has(n) };
};

async function rig() {
  const dir = await mkdtemp(join(tmpdir(), 'bp-switch-'));
  dirs.push(dir);
  const models = join(dir, 'models');
  await mkdir(models, { recursive: true });
  const gemma = join(models, 'gemma-4-test.gguf');
  await writeFakeGguf(gemma, { paddingBytes: 4096 });
  const service = await startFakeOpenAIServer({ models: ['qwen3:8b'], responder: () => ({ text: 'Bonjour depuis Ollama.' }) });
  services.push(service);
  const core = createCore({
    dataDir: join(dir, 'data'),
    env: {},
    home: join(dir, 'home'),
    llamaCommand: [process.execPath, BIN],
    modelRoots: [{ dir: models, source: 'custom' }],
    gpuMemory: async () => 24 * 1024 ** 3,
    llamaReleases: null,
    gh: null,
    secrets: vault(),
    logger: () => undefined,
  });
  cores.push(core);
  await mkdir(join(dir, 'home'), { recursive: true });
  await core.loadModel(gemma);
  const provider = await core.providers.add({ kind: 'openai-compat', label: 'Ollama', url: `${service.url}/v1`, server: 'ollama' });
  const handler = createAgentHandler(core);
  const history: { role: string; content: string }[] = [];
  const say = async (text: string): Promise<string> => {
    history.push({ role: 'user', content: text });
    const response = await handler(
      new Request(`${AGENT_ENDPOINT}/c/c1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, messageId: `m${history.length}`, request: { messages: history, modelId: '' }, clientTools: [] }),
      }),
    );
    expect(response.status).toBe(200);
    const answer = (await response.text())
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; delta?: string })
      .map((line) => (line.type === 'text-delta' ? (line.delta ?? '') : ''))
      .join('');
    history.push({ role: 'assistant', content: answer });
    return answer;
  };
  return { core, gemma, service, provider, say };
}

describe('a conversation changes provider between two turns (task 9.3)', () => {
  it('to a service: the next turn goes there; the built-in engine’s memory of it stays saved', async () => {
    const { core, service, provider, say } = await rig();
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: '', mode: 'repetition' });
    await say('Première question');
    expect(service.requests).toHaveLength(0);
    await core.switchProvider('c1', provider.id, 'qwen3:8b');
    expect(await core.conversationStore.get('c1')).toMatchObject({ engineId: provider.id, modelId: 'qwen3:8b' });
    expect(await say('Deuxième question')).toBe('Bonjour depuis Ollama.');
    expect(service.requests).toHaveLength(1);
  }, 30_000);

  it('back to the built-in engine: the conversation is rendered again for its model, the service’s turns included', async () => {
    const { core, gemma, provider, say } = await rig();
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: '', mode: 'repetition' });
    await say('Première question');
    await core.switchProvider('c1', provider.id, 'qwen3:8b');
    await say('Deuxième question');
    await core.switchModel(gemma, { conversationId: 'c1' });
    expect(await core.conversationStore.get('c1')).toMatchObject({ engineId: 'builtin' });
    await say('Troisième question');
    const meta = await core.conversationStore.get('c1');
    const entries = (await openJournal(core.conversationStore.dir, 'c1', meta!.branchId)).entries();
    const refrozen = entries.findLast((entry) => entry.kind === 'engine');
    expect(refrozen?.rendered).toContain('Deuxième question');
    expect(refrozen?.rendered).toContain('Bonjour depuis Ollama.');
    expect(entries.at(-1)).toMatchObject({ kind: 'assistant' });
  }, 30_000);
});
