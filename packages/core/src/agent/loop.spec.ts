import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLlamaCppBackend } from '../backend/llamacpp/llamacpp-backend.js';
import type { Backend } from '../backend/types.js';
import { PermissionEngine, type PlayMode } from '../permissions/engine.js';
import { ToolRegistry } from '../tools/registry.js';
import type { ToolDef, ToolHandler } from '../tools/types.js';
import {
  startFakeLlamaServer,
  type FakeLlamaServer,
} from '../testing/fake-llama-server.js';
import type { TranscriptEntry } from '../backend/types.js';
import { AgentLoop, type AgentEvent, type ApprovalResolver } from './loop.js';

let servers: FakeLlamaServer[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

const toolCall = (name: string, args: Record<string, unknown> = {}): string =>
  `<tool_call>{"name": "${name}", "arguments": ${JSON.stringify(args)}}</tool_call>`;

/** Répond selon le nombre d'appels déjà servis (scénario multi-tours). */
function scripted(...replies: string[]): (prompt: string) => string {
  let turn = 0;
  return () => replies[Math.min(turn++, replies.length - 1)] ?? '';
}

const def = (name: string, effect: ToolDef['effect'] = 'read'): ToolDef => ({
  name,
  description: `outil ${name}`,
  inputSchema: { type: 'object', properties: {} },
  effect,
});

interface Rig {
  loop: AgentLoop;
  transcript: TranscriptEntry[];
  registry: ToolRegistry;
  permissions: PermissionEngine;
  backend: Backend;
  calls: { name: string; args: Record<string, unknown> }[];
}

async function rig(options: {
  replies: string[];
  tools?: { def: ToolDef; handler?: ToolHandler }[];
  mode?: PlayMode;
  approve?: ApprovalResolver;
  maxTurns?: number;
}): Promise<Rig> {
  const server = await startFakeLlamaServer({
    responder: scripted(...options.replies),
  });
  servers.push(server);
  const backend = createLlamaCppBackend({ mode: 'remote', url: server.url });
  await backend.start();

  const registry = new ToolRegistry();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  for (const tool of options.tools ?? []) {
    const handler: ToolHandler =
      tool.handler ??
      (async (args) => {
        calls.push({ name: tool.def.name, args });
        return { ok: true, content: `résultat de ${tool.def.name}` };
      });
    registry.register(tool.def, handler);
  }

  const permissions = new PermissionEngine(options.mode ?? 'impro');
  const loop = new AgentLoop({
    backend,
    registry,
    permissions,
    conversationId: 'conv-test',
    system: { roots: ['C:\\projet'] },
    ...(options.approve ? { approve: options.approve } : {}),
    ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
  });

  return { loop, transcript: [] as TranscriptEntry[], registry, permissions, backend, calls };
}

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

describe('AgentLoop — tour simple', () => {
  it('streame la réponse et termine sans outil', async () => {
    const { loop, transcript } = await rig({ replies: ['Bonjour Paul.'] });
    const { all, text } = await collect(
      loop.run(transcript, 'Salut', new AbortController().signal),
    );
    expect(text).toBe('Bonjour Paul.');
    expect(all.at(-1)?.type).toBe('turn_end');
    expect(all.some((e) => e.type === 'tool_call')).toBe(false);
  });

  it('appende le tour au transcript (user puis assistant)', async () => {
    const { loop, transcript } = await rig({ replies: ['Réponse.'] });
    await collect(loop.run(transcript, 'Question', new AbortController().signal));
    expect(transcript).toEqual([
      { role: 'user', text: 'Question' },
      expect.objectContaining({ role: 'assistant', text: 'Réponse.' }),
    ]);
  });

  it('remonte le raisonnement séparément du texte', async () => {
    const { loop, transcript } = await rig({
      replies: ['<think>je pense</think>Voilà.'],
    });
    const { all, text } = await collect(
      loop.run(transcript, 'x', new AbortController().signal),
    );
    expect(text).toBe('Voilà.');
    expect(all.filter((e) => e.type === 'thinking').map((e) => e.text).join('')).toBe(
      'je pense',
    );
  });

  it('expose le coût de prefill et la part de cache', async () => {
    const { loop, transcript } = await rig({ replies: ['ok'] });
    const { all } = await collect(loop.run(transcript, 'x', new AbortController().signal));
    const end = all.find((e) => e.type === 'turn_end');
    expect(end).toBeDefined();
    expect(typeof (end as { promptMs: number }).promptMs).toBe('number');
  });
});

describe('AgentLoop — outils', () => {
  it('exécute un appel puis boucle jusqu’à la réponse finale', async () => {
    const { loop, transcript, calls } = await rig({
      replies: [toolCall('read_file', { path: 'a.ts' }), 'Le fichier dit bonjour.'],
      tools: [{ def: def('read_file') }],
    });
    const { all, text } = await collect(
      loop.run(transcript, 'lis a.ts', new AbortController().signal),
    );
    expect(calls).toEqual([{ name: 'read_file', args: { path: 'a.ts' } }]);
    expect(all.some((e) => e.type === 'tool_call')).toBe(true);
    expect(
      all.find((e) => e.type === 'tool_result'),
    ).toMatchObject({ name: 'read_file', ok: true });
    expect(text).toContain('Le fichier dit bonjour.');
  });

  it('appende les résultats d’outils au transcript', async () => {
    const { loop, transcript } = await rig({
      replies: [toolCall('read_file'), 'fini'],
      tools: [{ def: def('read_file') }],
    });
    await collect(loop.run(transcript, 'x', new AbortController().signal));
    expect(transcript.map((e) => e.role)).toEqual([
      'user',
      'assistant',
      'tool_results',
      'assistant',
    ]);
    const results = transcript.find((e) => e.role === 'tool_results');
    expect(results).toMatchObject({
      results: [{ name: 'read_file', ok: true }],
    });
  });

  it('exécute plusieurs appels du même tour dans l’ordre', async () => {
    const { loop, transcript, calls } = await rig({
      replies: [toolCall('a') + toolCall('b'), 'fini'],
      tools: [{ def: def('a') }, { def: def('b') }],
    });
    await collect(loop.run(transcript, 'x', new AbortController().signal));
    expect(calls.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('répond proprement à un outil inconnu, en rappelant l’inventaire', async () => {
    const { loop, transcript } = await rig({
      replies: [toolCall('fantome'), 'compris'],
      tools: [{ def: def('read_file') }],
    });
    const { all } = await collect(loop.run(transcript, 'x', new AbortController().signal));
    const result = all.find((e) => e.type === 'tool_result') as {
      ok: boolean;
      content: string;
    };
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/fantome/);
    expect(result.content).toContain('read_file');
  });

  it('transforme une exception de handler en résultat d’échec', async () => {
    const { loop, transcript } = await rig({
      replies: [toolCall('casse'), 'compris'],
      tools: [
        {
          def: def('casse'),
          handler: async () => {
            throw new Error('boum');
          },
        },
      ],
    });
    const { all } = await collect(loop.run(transcript, 'x', new AbortController().signal));
    const result = all.find((e) => e.type === 'tool_result') as { ok: boolean; content: string };
    expect(result.ok).toBe(false);
    expect(result.content).toContain('boum');
  });

  it('borne le nombre d’allers-retours', async () => {
    const { loop, transcript, calls } = await rig({
      replies: [toolCall('boucle')], // le modèle rappelle l'outil sans fin
      tools: [{ def: def('boucle') }],
      maxTurns: 3,
    });
    const { all } = await collect(loop.run(transcript, 'x', new AbortController().signal));
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(all.some((e) => e.type === 'error')).toBe(true);
  });
});

describe('AgentLoop — permissions', () => {
  it('mode Lecture : une écriture est refusée sans exécuter le handler', async () => {
    const { loop, transcript, calls } = await rig({
      replies: [toolCall('write_file', { path: 'a' }), 'compris'],
      tools: [{ def: def('write_file', 'write') }],
      mode: 'lecture',
    });
    const { all } = await collect(loop.run(transcript, 'x', new AbortController().signal));
    expect(calls).toEqual([]);
    const result = all.find((e) => e.type === 'tool_result') as { ok: boolean; content: string };
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/denied|play mode/i);
  });

  it('mode Répétition : l’accord de l’utilisateur est demandé puis honoré', async () => {
    const approve = vi.fn<ApprovalResolver>(async () => true);
    const { loop, transcript, calls } = await rig({
      replies: [toolCall('write_file', { path: 'a' }), 'fait'],
      tools: [{ def: def('write_file', 'write') }],
      mode: 'repetition',
      approve,
    });
    await collect(loop.run(transcript, 'x', new AbortController().signal));
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0]![0]).toMatchObject({ tool: 'write_file' });
    expect(calls).toHaveLength(1);
  });

  it('mode Répétition : un refus de l’utilisateur n’exécute rien', async () => {
    const { loop, transcript, calls } = await rig({
      replies: [toolCall('write_file'), 'compris'],
      tools: [{ def: def('write_file', 'write') }],
      mode: 'repetition',
      approve: async () => false,
    });
    const { all } = await collect(loop.run(transcript, 'x', new AbortController().signal));
    expect(calls).toEqual([]);
    const result = all.find((e) => e.type === 'tool_result') as { ok: boolean };
    expect(result.ok).toBe(false);
  });

  it('sans résolveur d’accord, une action à autoriser est refusée (fail-safe)', async () => {
    const { loop, transcript, calls } = await rig({
      replies: [toolCall('write_file'), 'compris'],
      tools: [{ def: def('write_file', 'write') }],
      mode: 'repetition',
    });
    await collect(loop.run(transcript, 'x', new AbortController().signal));
    expect(calls).toEqual([]);
  });

  it('mode Plume : une édition passe sans demander', async () => {
    const approve = vi.fn<ApprovalResolver>(async () => true);
    const { loop, transcript, calls } = await rig({
      replies: [toolCall('write_file'), 'fait'],
      tools: [{ def: def('write_file', 'write') }],
      mode: 'plume',
      approve,
    });
    await collect(loop.run(transcript, 'x', new AbortController().signal));
    expect(approve).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });
});

describe('AgentLoop — inventaire changeant', () => {
  it('la grammaire envoyée suit le registre courant', async () => {
    const { loop, transcript, registry } = await rig({
      replies: ['ok'],
      tools: [{ def: def('read_file') }],
    });
    registry.register(def('run_shell', 'execute'), async () => ({
      ok: true,
      content: '',
    }));
    await collect(loop.run(transcript, 'x', new AbortController().signal));
    const grammar = registry.grammar()!.grammar;
    expect(grammar).toContain('run_shell');
  });
});
