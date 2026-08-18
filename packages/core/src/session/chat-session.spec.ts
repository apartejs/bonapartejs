import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentEvent } from '../agent/loop.js';
import { createLlamaCppBackend } from '../backend/llamacpp/llamacpp-backend.js';
import type { Backend } from '../backend/types.js';
import { ConversationStore } from '../conversation/store.js';
import { KvStore, type LiveBackendConfig } from '../kv/kv-store.js';
import { PermissionEngine } from '../permissions/engine.js';
import { ToolRegistry } from '../tools/registry.js';
import type { ToolDef } from '../tools/types.js';
import {
  startFakeLlamaServer,
  type FakeLlamaServer,
  type FakeSlotSnapshot,
} from '../testing/fake-llama-server.js';
import { ChatSession, type ChatSessionOptions } from './chat-session.js';

const LIVE: LiveBackendConfig = {
  modelFingerprint: 'fp-1',
  nCtx: 8192,
  cacheTypeK: 'f16',
  cacheTypeV: 'f16',
  buildTag: 'b1',
};

const def = (name: string, effect: ToolDef['effect'] = 'read'): ToolDef => ({
  name,
  description: `outil ${name}`,
  inputSchema: { type: 'object', properties: {} },
  effect,
});

let servers: FakeLlamaServer[] = [];
let dirs: string[] = [];

interface Rig {
  server: FakeLlamaServer;
  backend: Backend;
  registry: ToolRegistry;
  options: ChatSessionOptions;
  dir: string;
}

async function makeRig(options: {
  replies?: string[];
  disk?: Map<string, FakeSlotSnapshot>;
  baseDir?: string;
  live?: LiveBackendConfig;
  tools?: ToolDef[];
  msPerToken?: number;
}): Promise<Rig> {
  let turn = 0;
  const replies = options.replies ?? ['ok'];
  const server = await startFakeLlamaServer({
    msPerToken: options.msPerToken ?? 10,
    responder: () => replies[Math.min(turn++, replies.length - 1)] ?? '',
    ...(options.disk ? { files: options.disk } : {}),
  });
  servers.push(server);

  const backend = createLlamaCppBackend({ mode: 'remote', url: server.url });
  await backend.start();

  const dir = options.baseDir ?? (await mkdtemp(join(tmpdir(), 'bp-session-')));
  if (!options.baseDir) dirs.push(dir);

  const registry = new ToolRegistry();
  for (const tool of options.tools ?? []) {
    registry.register(tool, async () => ({
      ok: true,
      content: `résultat de ${tool.name}`,
    }));
  }

  return {
    server,
    backend,
    registry,
    dir,
    options: {
      backend,
      kv: new KvStore(join(dir, 'kv')),
      store: new ConversationStore(join(dir, 'conversations')),
      registry,
      permissions: new PermissionEngine('impro'),
      projectRoot: 'C:\\projet',
      live: options.live ?? LIVE,
    },
  };
}

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  await Promise.all(
    dirs.map((d) =>
      rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(
        () => undefined,
      ),
    ),
  );
  servers = [];
  dirs = [];
});

async function drain(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const all: AgentEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

describe('ChatSession — ouverture', () => {
  it('crée la conversation et fige le prompt système avec l’inventaire', async () => {
    const rig = await makeRig({ tools: [def('read_file')] });
    const { restore } = await ChatSession.open(rig.options, 'conv-1');
    expect(restore).toMatchObject({ restored: false, reason: 'missing' });

    const meta = await rig.options.store.meta('conv-1');
    expect((meta.backendState as { systemPrompt: string }).systemPrompt).toContain('read_file');
    expect(meta.toolNames).toEqual(['read_file']);
  });

  it('réutilise le prompt figé plutôt que de le reconstruire', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bp-session-frozen-'));
    dirs.push(dir);
    const first = await makeRig({ baseDir: dir, tools: [def('read_file')] });
    await ChatSession.open(first.options, 'conv-1');
    const frozen = (await first.options.store.meta('conv-1')).backendState;

    // Réouverture avec un inventaire différent : le prompt ne doit pas bouger.
    const second = await makeRig({
      baseDir: dir,
      tools: [def('read_file'), def('run_shell', 'execute')],
    });
    await ChatSession.open(second.options, 'conv-1');
    expect((await second.options.store.meta('conv-1')).backendState).toEqual(frozen);
  });

  it('annonce un delta d’inventaire par un message de service appendé', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bp-session-delta-'));
    dirs.push(dir);
    const first = await makeRig({ baseDir: dir, tools: [def('read_file')] });
    await ChatSession.open(first.options, 'conv-1');

    const second = await makeRig({
      baseDir: dir,
      tools: [def('read_file'), def('run_shell', 'execute')],
    });
    await ChatSession.open(second.options, 'conv-1');

    const events = await second.options.store.loadEvents('conv-1');
    const service = events.find((e) => e.type === 'service') as { text: string };
    expect(service.text).toContain('run_shell');
    // L'inventaire de référence a suivi : pas de ré-annonce au prochain coup.
    expect((await second.options.store.meta('conv-1')).toolNames).toEqual([
      'read_file',
      'run_shell',
    ]);
  });

  it('n’appende rien quand l’inventaire n’a pas bougé', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bp-session-nodelta-'));
    dirs.push(dir);
    const first = await makeRig({ baseDir: dir, tools: [def('read_file')] });
    await ChatSession.open(first.options, 'conv-1');
    const second = await makeRig({ baseDir: dir, tools: [def('read_file')] });
    await ChatSession.open(second.options, 'conv-1');
    expect(await second.options.store.loadEvents('conv-1')).toEqual([]);
  });
});

describe('ChatSession — envoi', () => {
  it('streame la réponse et persiste le tour', async () => {
    const rig = await makeRig({ replies: ['Bonjour Paul.'] });
    const { session } = await ChatSession.open(rig.options, 'conv-1');
    const events = await drain(session.send('Salut'));

    const text = events
      .filter((e): e is Extract<AgentEvent, { type: 'token' }> => e.type === 'token')
      .map((e) => e.text)
      .join('');
    expect(text).toBe('Bonjour Paul.');

    const persisted = await rig.options.store.loadEvents('conv-1');
    expect(persisted.map((e) => e.type)).toEqual(['user', 'assistant']);
  });

  it('persiste la séquence exacte d’un tour avec outil (rejeu identique)', async () => {
    const rig = await makeRig({
      replies: [
        '<tool_call>{"name": "read_file", "arguments": {}}</tool_call>',
        'Voilà.',
      ],
      tools: [def('read_file')],
    });
    const { session } = await ChatSession.open(rig.options, 'conv-1');
    await drain(session.send('lis'));

    const persisted = await rig.options.store.loadEvents('conv-1');
    expect(persisted.map((e) => e.type)).toEqual([
      'user',
      'assistant',
      'tool_results',
      'assistant',
    ]);

    // Le verbatim du fournisseur est conservé : c'est lui qui permet un
    // rendu octet-identique au rejeu (cf. turn-renderer.spec).
    const first = persisted[1] as { entry: { raw?: string; calls?: unknown[] } };
    expect(first.entry.raw).toContain('<tool_call>');
    expect(first.entry.calls).toHaveLength(1);
  });
});

describe('ChatSession — persistance du contexte', () => {
  it('CYCLE : envoi → save → redémarrage → restauration → reprise quasi gratuite', async () => {
    const disk = new Map<string, FakeSlotSnapshot>();
    const base = await mkdtemp(join(tmpdir(), 'bp-session-cycle-'));
    dirs.push(base);

    const rigA = await makeRig({
      disk,
      baseDir: base,
      replies: ['M'.repeat(400)],
      msPerToken: 10,
    });
    const { session: a } = await ChatSession.open(rigA.options, 'conv-1');
    const firstEvents = await drain(a.send('M'.repeat(400)));
    const firstEnd = firstEvents.find((e) => e.type === 'turn_end') as {
      promptMs: number;
    };
    expect(firstEnd.promptMs).toBeGreaterThan(1000);
    expect(await a.save()).toBe(true);
    await rigA.backend.stop();
    await rigA.server.close();

    const rigB = await makeRig({ disk, baseDir: base, replies: ['suite'] });
    const { session: b, restore } = await ChatSession.open(rigB.options, 'conv-1');
    expect(restore).toMatchObject({ restored: true });

    const followUp = await drain(b.send('et après ?'));
    const secondEnd = followUp.find((e) => e.type === 'turn_end') as {
      promptMs: number;
    };
    expect(secondEnd.promptMs).toBeLessThan(firstEnd.promptMs / 5);
  });

  it('refuse la restauration si la config vivante a changé', async () => {
    const disk = new Map<string, FakeSlotSnapshot>();
    const base = await mkdtemp(join(tmpdir(), 'bp-session-mismatch-'));
    dirs.push(base);

    const rigA = await makeRig({ disk, baseDir: base });
    const { session } = await ChatSession.open(rigA.options, 'conv-1');
    await drain(session.send('bonjour'));
    await session.save();
    await rigA.server.close();

    const rigB = await makeRig({
      disk,
      baseDir: base,
      live: { ...LIVE, nCtx: 4096 },
    });
    const { restore } = await ChatSession.open(rigB.options, 'conv-1');
    expect(restore).toEqual({ restored: false, reason: 'nCtx' });
  });

  it('save() rend false quand le backend n’a pas la persistance', async () => {
    const rig = await makeRig({});
    const backend = createLlamaCppBackend({
      mode: 'remote',
      url: rig.server.url,
      assumeKvPersistence: false,
    });
    await backend.start();
    const { session, restore } = await ChatSession.open(
      { ...rig.options, backend },
      'conv-nokv',
    );
    expect(restore).toEqual({ restored: false, reason: 'unsupported' });
    expect(await session.save()).toBe(false);
  });
});
