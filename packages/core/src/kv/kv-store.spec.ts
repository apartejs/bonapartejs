import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LlamaCppHttpClient } from '../backend/llamacpp/http-client.js';
import type { SlotApi } from '../backend/types.js';
import {
  startFakeLlamaServer,
  type FakeLlamaServer,
} from '../testing/fake-llama-server.js';
import { canRestore, KvStore, type KvManifest, type LiveBackendConfig } from './kv-store.js';

const LIVE: LiveBackendConfig = {
  modelFingerprint: 'fp-qwen3-abc123',
  nCtx: 32768,
  cacheTypeK: 'q8_0',
  cacheTypeV: 'q8_0',
  buildTag: 'b6521',
};

function manifest(overrides: Partial<KvManifest> = {}): KvManifest {
  return {
    schemaVersion: 1,
    conversationId: 'conv-1',
    promptTokenCount: 100,
    slotFileBytes: 819200,
    savedAt: '2026-08-18T12:00:00.000Z',
    ...LIVE,
    ...overrides,
  };
}

describe('canRestore (politique stricte)', () => {
  it('accepte un manifest identique à la config vivante', () => {
    expect(canRestore(manifest(), LIVE)).toEqual({ ok: true });
  });

  it.each([
    ['model', { modelFingerprint: 'fp-autre' }],
    ['nCtx', { nCtx: 16384 }],
    ['cacheType', { cacheTypeK: 'f16', cacheTypeV: 'f16' }],
    ['buildTag', { buildTag: 'b9999' }],
  ] as const)('refuse sur mismatch %s', (reason, override) => {
    expect(canRestore(manifest(override), LIVE)).toEqual({ ok: false, reason });
  });
});

describe('KvStore (contre le faux llama-server)', () => {
  let servers: FakeLlamaServer[] = [];
  let dirs: string[] = [];

  async function setup(msPerToken = 10): Promise<{
    server: FakeLlamaServer;
    slots: SlotApi;
    client: LlamaCppHttpClient;
    store: KvStore;
    dir: string;
  }> {
    const server = await startFakeLlamaServer({ msPerToken, responder: () => '' });
    servers.push(server);
    const client = new LlamaCppHttpClient(server.url);
    const slots: SlotApi = {
      save: (id, f) => client.saveSlot(id, f),
      restore: (id, f) => client.restoreSlot(id, f),
      erase: (id) => client.eraseSlot(id),
    };
    const dir = await mkdtemp(join(tmpdir(), 'bp-kv-'));
    dirs.push(dir);
    return { server, slots, client, store: new KvStore(dir), dir };
  }

  async function prefill(client: LlamaCppHttpClient, prompt: string): Promise<void> {
    for await (const event of client.complete({ prompt, idSlot: 0 })) {
      void event;
    }
  }

  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    servers = [];
    dirs = [];
  });

  it('saveState sauvegarde le slot et écrit un manifest complet', async () => {
    const { slots, client, store, dir } = await setup();
    await prefill(client, 'x'.repeat(400)); // 100 tokens

    const saved = await store.saveState(slots, 0, 'conv-1', LIVE);

    expect(saved.conversationId).toBe('conv-1');
    expect(saved.promptTokenCount).toBe(100);
    expect(saved.slotFileBytes).toBeGreaterThan(0);
    expect(saved.modelFingerprint).toBe(LIVE.modelFingerprint);

    const onDisk = JSON.parse(
      await readFile(join(dir, 'conv-1.manifest.json'), 'utf8'),
    ) as KvManifest;
    expect(onDisk.promptTokenCount).toBe(100);
    expect(onDisk.schemaVersion).toBe(1);
  });

  it('restoreState restaure quand tout matche (prefill quasi nul ensuite)', async () => {
    const { slots, client, store } = await setup();
    const prompt = 'x'.repeat(400);
    await prefill(client, prompt);
    await store.saveState(slots, 0, 'conv-1', LIVE);
    await client.eraseSlot(0); // simule une autre conversation passée par là

    const outcome = await store.restoreState(slots, 0, 'conv-1', LIVE);
    expect(outcome).toMatchObject({ restored: true, nRestored: 100 });

    let promptMs = -1;
    for await (const event of client.complete({
      prompt: prompt + 'y'.repeat(8),
      idSlot: 0,
    })) {
      if (event.type === 'done') promptMs = event.stats.promptMs;
    }
    expect(promptMs).toBe(20); // 2 tokens seulement — l'état a bien été restauré
  });

  it('refuse le restore sur mismatch nCtx SANS toucher au serveur', async () => {
    const { slots, client, store, server } = await setup();
    const prompt = 'x'.repeat(400);
    await prefill(client, prompt);
    await store.saveState(slots, 0, 'conv-1', LIVE);
    await client.eraseSlot(0);

    const outcome = await store.restoreState(slots, 0, 'conv-1', {
      ...LIVE,
      nCtx: 16384,
    });
    expect(outcome).toEqual({ restored: false, reason: 'nCtx' });
    expect(server.getSlotTokens(0)).toHaveLength(0); // aucun restore effectué
  });

  it('signale proprement un manifest absent', async () => {
    const { slots, store } = await setup();
    const outcome = await store.restoreState(slots, 0, 'conv-inconnue', LIVE);
    expect(outcome).toEqual({ restored: false, reason: 'missing' });
  });

  it('signale proprement un manifest corrompu', async () => {
    const { slots, store, dir } = await setup();
    await writeFile(join(dir, 'conv-1.manifest.json'), '{pas du json', 'utf8');
    const outcome = await store.restoreState(slots, 0, 'conv-1', LIVE);
    expect(outcome).toEqual({ restored: false, reason: 'corrupt' });
  });
});
