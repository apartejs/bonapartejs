/**
 * « Réglages de conversation » (task 12.4, the built-in entry `conversation-settings`): a conversation's
 * temperature reaches the engine with its turns; its reasoning switched off opens each answer with the empty thought
 * channel, the frozen prompt untouched; switched off, the entry gives the defaults back.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_ENDPOINT, createAgentHandler } from '../agent/handler.js';
import { createCore, type Core } from '../api.js';
import { familyLayer } from '../families/index.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';

const servers: FakeLlamaServer[] = [];
const cores: Core[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop().catch(() => undefined);
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
});

async function rig() {
  const bodies: Record<string, unknown>[] = [];
  const server = await startFakeLlamaServer({ responder: () => 'ok', onCompletion: (body) => bodies.push(body) });
  servers.push(server);
  const dir = await mkdtemp(join(tmpdir(), 'bp-conv-settings-'));
  dirs.push(dir);
  await mkdir(join(dir, 'data', 'config'), { recursive: true });
  await writeFile(join(dir, 'data', 'config', 'global.json'), JSON.stringify({ backend: { mode: 'remote', url: server.url } }));
  const core = createCore({ dataDir: join(dir, 'data'), env: {}, home: join(dir, 'home'), gh: null, logger: () => undefined });
  cores.push(core);
  await core.plugins.activateBuiltinEntries();
  const handler = createAgentHandler(core);
  const history: { role: string; content: string }[] = [];
  const say = async (text: string): Promise<void> => {
    history.push({ role: 'user', content: text });
    const response = await handler(
      new Request(`${AGENT_ENDPOINT}/c/c1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, messageId: `m${history.length}`, request: { messages: history, modelId: '' }, clientTools: [] }),
      }),
    );
    await response.text();
    history.push({ role: 'assistant', content: 'ok' });
  };
  return { core, say, bodies };
}

describe('the settings of one conversation', { timeout: 30_000 }, () => {
  it('its temperature goes with its turns; its reasoning off opens the answer with the empty thought channel', async () => {
    const { core, say, bodies } = await rig();
    await say('Bonjour');
    const before = String(bodies.at(-1)!['prompt']);
    await core.conversationSettings.set('c1', { temperature: 0.2, thinking: false });
    expect(await core.conversationSettings.get('c1')).toMatchObject({ temperature: 0.2, thinking: false });
    await say('Encore');
    const after = bodies.at(-1)!;
    expect(after['temperature']).toBe(0.2);
    expect(String(after['prompt']).endsWith(familyLayer('gemma').beginAssistant({ thinking: false }))).toBe(true);
    // The frozen prompt is the same: the cache keeps serving it.
    expect(String(after['prompt']).startsWith(before.slice(0, before.lastIndexOf('<|turn>user')))).toBe(true);
  });

  it('switched off, the entry gives the defaults back', async () => {
    const { core, say, bodies } = await rig();
    await say('Bonjour');
    await core.conversationSettings.set('c1', { temperature: 0.2, thinking: false });
    await core.plugins.setEnabled('conversation-settings', false);
    await say('Encore');
    expect(bodies.at(-1)!['temperature']).toBeUndefined();
    expect(String(bodies.at(-1)!['prompt']).endsWith(familyLayer('gemma').beginAssistant({ thinking: true }))).toBe(true);
  });

  it('refuses a temperature out of range, and a context cap that is no whole number', async () => {
    const { core, say } = await rig();
    await say('Bonjour');
    await expect(core.conversationSettings.set('c1', { temperature: 3 })).rejects.toThrow(/temperature/i);
    await expect(core.conversationSettings.set('c1', { contextCap: 12.5 })).rejects.toThrow(/context/i);
  });
});
