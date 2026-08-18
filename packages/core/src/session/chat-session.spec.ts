import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLlamaCppBackend } from '../backend/llamacpp/llamacpp-backend.js';
import type { Backend, CompletionStats } from '../backend/types.js';
import { ConversationStore } from '../conversation/store.js';
import { KvStore, type LiveBackendConfig } from '../kv/kv-store.js';
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

let servers: FakeLlamaServer[] = [];
let dirs: string[] = [];

interface Rig {
  server: FakeLlamaServer;
  backend: Backend;
  options: ChatSessionOptions;
}

async function makeRig(
  disk: Map<string, FakeSlotSnapshot>,
  baseDir?: string,
  live: LiveBackendConfig = LIVE,
): Promise<Rig> {
  const server = await startFakeLlamaServer({
    msPerToken: 10,
    responder: (prompt) => `écho:${prompt.length}`,
    files: disk,
  });
  servers.push(server);
  const backend = createLlamaCppBackend({ mode: 'remote', url: server.url });
  await backend.start();

  const dir = baseDir ?? (await mkdtemp(join(tmpdir(), 'bp-session-')));
  if (!baseDir) dirs.push(dir);

  return {
    server,
    backend,
    options: {
      backend,
      kv: new KvStore(join(dir, 'kv')),
      store: new ConversationStore(join(dir, 'conversations')),
      systemPrompt: 'Tu es bonaparte.',
      live,
    },
  };
}

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  servers = [];
  dirs = [];
});

async function drain(
  events: AsyncIterable<{ type: string; text?: string; stats?: CompletionStats }>,
): Promise<{ text: string; stats: CompletionStats }> {
  let text = '';
  let stats: CompletionStats | null = null;
  for await (const event of events) {
    if (event.type === 'token') text += event.text ?? '';
    if (event.type === 'done') stats = event.stats ?? null;
  }
  if (!stats) throw new Error('pas de done');
  return { text, stats };
}

describe('ChatSession', () => {
  it('open crée la conversation si absente (restore missing) et send streame + persiste', async () => {
    const rig = await makeRig(new Map());
    const { session, restore } = await ChatSession.open(rig.options, 'conv-1');
    expect(restore).toMatchObject({ restored: false, reason: 'missing' });

    const { text, stats } = await drain(session.send('Bonjour', { thinking: true }));
    expect(text).toMatch(/^écho:/);
    expect(stats.promptMs).toBeGreaterThan(0);

    const events = await rig.options.store.loadEvents('conv-1');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'user', text: 'Bonjour' });
    expect(events[1]).toMatchObject({ type: 'assistant', thinking: true });
  });

  it('CYCLE COMPLET : send → save → redémarrage → open restauré → reprise quasi gratuite', async () => {
    const disk = new Map<string, FakeSlotSnapshot>();
    const base = await mkdtemp(join(tmpdir(), 'bp-session-cycle-'));
    dirs.push(base);

    // Session A — paie le prefill complet puis sauvegarde.
    const rigA = await makeRig(disk, base);
    const { session: a } = await ChatSession.open(rigA.options, 'conv-1');
    const first = await drain(a.send('M'.repeat(400), { thinking: false }));
    expect(first.stats.promptMs).toBeGreaterThan(1000); // gros prefill payé
    expect(await a.save()).toBe(true);
    await rigA.backend.stop();
    await rigA.server.close();

    // Session B — nouveau « process » (nouveau serveur, mêmes fichiers disque).
    const rigB = await makeRig(disk, base);
    const { session: b, restore } = await ChatSession.open(rigB.options, 'conv-1');
    expect(restore).toMatchObject({ restored: true });

    const followUp = await drain(b.send('Suite ?', { thinking: false }));
    // Seul le nouveau tour se paie : très loin du prefill initial.
    expect(followUp.stats.promptMs).toBeLessThan(first.stats.promptMs / 5);
  });

  it('refuse le restore si la config vivante a changé (nCtx) et le signale', async () => {
    const disk = new Map<string, FakeSlotSnapshot>();
    const base = await mkdtemp(join(tmpdir(), 'bp-session-mismatch-'));
    dirs.push(base);

    const rigA = await makeRig(disk, base);
    const { session: a } = await ChatSession.open(rigA.options, 'conv-1');
    await drain(a.send('Bonjour', { thinking: true }));
    await a.save();
    await rigA.server.close();

    const rigB = await makeRig(disk, base, { ...LIVE, nCtx: 4096 });
    const { restore } = await ChatSession.open(rigB.options, 'conv-1');
    expect(restore).toEqual({ restored: false, reason: 'nCtx' });
  });

  it('save() retourne false quand le backend n’a pas kvPersistence', async () => {
    const rig = await makeRig(new Map());
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
    await drain(session.send('x', { thinking: true }));
    expect(await session.save()).toBe(false);
  });

  it('deux send successifs profitent du cache de préfixe dans la même session', async () => {
    const rig = await makeRig(new Map());
    const { session } = await ChatSession.open(rig.options, 'conv-1');
    const first = await drain(session.send('A'.repeat(200), { thinking: false }));
    const second = await drain(session.send('ok', { thinking: false }));
    expect(second.stats.promptMs).toBeLessThan(first.stats.promptMs);
  });
});
