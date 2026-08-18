import { afterEach, describe, expect, it } from 'vitest';
import { AgentLoop, type AgentEvent } from '../../agent/loop.js';
import { PermissionEngine } from '../../permissions/engine.js';
import { ToolRegistry } from '../../tools/registry.js';
import type { ToolDef } from '../../tools/types.js';
import {
  startFakeOpenAiServer,
  type FakeOpenAiServer,
} from '../../testing/fake-openai-server.js';
import type { TranscriptEntry } from '../types.js';
import {
  createOpenAiCompatBackend,
  toChatMessages,
  toChatTools,
} from './openai-compat-backend.js';

let servers: FakeOpenAiServer[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

const def = (name: string, effect: ToolDef['effect'] = 'read'): ToolDef => ({
  name,
  description: `outil ${name}`,
  inputSchema: { type: 'object', properties: {} },
  effect,
});

async function collect(
  events: AsyncIterable<AgentEvent>,
): Promise<{ all: AgentEvent[]; text: string }> {
  const all: AgentEvent[] = [];
  for await (const event of events) all.push(event);
  return {
    all,
    text: all
      .filter((e): e is Extract<AgentEvent, { type: 'token' }> => e.type === 'token')
      .map((e) => e.text)
      .join(''),
  };
}

describe('mapping transcript → messages OpenAI', () => {
  it('traduit chaque rôle, et lie les résultats à leur appel', () => {
    const transcript: TranscriptEntry[] = [
      { role: 'user', text: 'lis a.ts' },
      {
        role: 'assistant',
        text: 'je regarde',
        calls: [{ name: 'read_file', arguments: { path: 'a.ts' } }],
      },
      {
        role: 'tool_results',
        results: [{ name: 'read_file', ok: true, content: 'const a = 1;' }],
      },
    ];
    const messages = toChatMessages('SYS', transcript);

    expect(messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(messages[1]).toEqual({ role: 'user', content: 'lis a.ts' });
    expect(messages[2]!.tool_calls?.[0]).toMatchObject({
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
    });
    // Le résultat référence l'id de l'appel auquel il répond.
    expect(messages[3]!.tool_call_id).toBe(messages[2]!.tool_calls![0]!.id);
  });

  it('rend un message de service comme un tour utilisateur', () => {
    const messages = toChatMessages('SYS', [
      { role: 'service', text: '[tool inventory update]' },
    ]);
    expect(messages[1]).toEqual({ role: 'user', content: '[tool inventory update]' });
  });

  it('marque un résultat en échec', () => {
    const messages = toChatMessages('SYS', [
      { role: 'tool_results', results: [{ name: 't', ok: false, content: 'boum' }] },
    ]);
    expect(messages[1]!.content).toContain('failed');
  });

  it('déclare les outils au format function-calling', () => {
    expect(toChatTools([def('read_file')])[0]).toMatchObject({
      type: 'function',
      function: { name: 'read_file', description: 'outil read_file' },
    });
  });
});

describe('backend OpenAI-compatible', () => {
  async function rig(replies: Parameters<typeof startFakeOpenAiServer>[0]['replies']) {
    const server = await startFakeOpenAiServer({ replies });
    servers.push(server);
    const backend = createOpenAiCompatBackend({
      baseUrl: server.url,
      model: 'fake-model',
      label: 'LM Studio (fixture)',
    });
    await backend.start();
    return { server, backend };
  }

  it('démarre en vérifiant /models', async () => {
    const { backend } = await rig([{ text: 'ok' }]);
    expect(backend.status()).toBe('ready');
  });

  it('échoue proprement si l’endpoint est injoignable', async () => {
    const backend = createOpenAiCompatBackend({
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'x',
    });
    await expect(backend.start()).rejects.toThrow();
    expect(backend.status()).toBe('crashed');
  });

  it('déclare honnêtement l’absence de persistance de contexte', async () => {
    const { backend } = await rig([{ text: 'ok' }]);
    expect(backend.capabilities.kvPersistence).toBe(false);
    expect(backend.slots).toBeUndefined();
  });

  it('recompose des arguments d’outil fragmentés', async () => {
    const { backend } = await rig([
      { calls: [{ name: 'read_file', arguments: { path: 'src/a.ts' } }] },
    ]);
    const events: unknown[] = [];
    for await (const event of backend.runTurn({
      conversationId: 'c1',
      system: { projectRoot: 'C:\\projet' },
      tools: [def('read_file')],
      transcript: [{ role: 'user', text: 'lis' }],
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }
    expect(events).toContainEqual({
      type: 'tool_use',
      call: { name: 'read_file', arguments: { path: 'src/a.ts' } },
    });
  });
});

describe('AGNOSTICITÉ : la même boucle, un backend sans prompt ni grammaire', () => {
  it('exécute un cycle outil complet contre un endpoint OpenAI-compatible', async () => {
    const server = await startFakeOpenAiServer({
      replies: [
        { text: 'je regarde ', calls: [{ name: 'read_file', arguments: { path: 'a.ts' } }] },
        { text: 'Le fichier dit bonjour.' },
      ],
    });
    servers.push(server);

    const backend = createOpenAiCompatBackend({
      baseUrl: server.url,
      model: 'fake-model',
    });
    await backend.start();

    const registry = new ToolRegistry();
    const calls: Record<string, unknown>[] = [];
    registry.register(def('read_file'), async (args) => {
      calls.push(args);
      return { ok: true, content: 'const a = 1;' };
    });

    const transcript: TranscriptEntry[] = [];
    const loop = new AgentLoop({
      backend,
      registry,
      permissions: new PermissionEngine('impro'),
      conversationId: 'conv-1',
      system: { projectRoot: 'C:\\projet' },
    });

    const { all, text } = await collect(
      loop.run(transcript, 'lis a.ts', new AbortController().signal),
    );

    expect(calls).toEqual([{ path: 'a.ts' }]);
    expect(text).toContain('Le fichier dit bonjour.');
    expect(all.at(-1)?.type).toBe('turn_end');
    expect(transcript.map((e) => e.role)).toEqual([
      'user',
      'assistant',
      'tool_results',
      'assistant',
    ]);

    // Le second tour a bien renvoyé l'historique complet au serveur, résultat
    // d'outil compris — c'est le backend qui a fait le mapping, pas la boucle.
    const second = server.requests[1] as { messages: { role: string }[] };
    expect(second.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
    ]);
  });
});
