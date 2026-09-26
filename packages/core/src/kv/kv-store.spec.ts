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

describe('canRestore — strict where llama.cpp is blind, tolerant where it checks itself', () => {
  // Read in llama.cpp on 2026-08-28 (llama-context.cpp state_seq_load_file,
  // llama-kv-cache.cpp state_read_*): a restore checks the file format
  // version, that the saved tokens FIT the slot's context, the layer count
  // and the K/V cell types — never the model's identity, never that n_ctx
  // is the same. So the model stays ours to pin; n_ctx only has to hold the
  // saved tokens; and a build is trusted to refuse a format it does not know.
  it('accepts a manifest identical to the live config', () => {
    expect(canRestore(manifest(), LIVE)).toEqual({ ok: true });
  });

  it.each([
    ['model', { modelFingerprint: 'fp-autre' }],
    ['cacheType', { cacheTypeK: 'f16', cacheTypeV: 'f16' }],
  ] as const)('refuses on %s mismatch', (reason, override) => {
    expect(canRestore(manifest(override), LIVE)).toEqual({ ok: false, reason });
  });

  it('accepts a state saved under a smaller context, as long as its tokens fit the live one', () => {
    expect(canRestore(manifest({ nCtx: 16384, promptTokenCount: 12000 }), LIVE)).toEqual({ ok: true });
    expect(canRestore(manifest({ nCtx: 65536, promptTokenCount: 12000 }), LIVE)).toEqual({ ok: true });
  });

  it('refuses a state whose tokens do not fit the live context', () => {
    expect(canRestore(manifest({ nCtx: 65536, promptTokenCount: 40000 }), LIVE)).toEqual({
      ok: false,
      reason: 'nCtx',
    });
  });

  it('does not refuse on the build tag alone: the server validates the file format itself', () => {
    expect(canRestore(manifest({ buildTag: 'b9999' }), LIVE)).toEqual({ ok: true });
  });
});

describe('KvStore (against the fake llama-server)', () => {
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

  it('savedTokens reads how many tokens a saved state holds — undefined without one', async () => {
    const { slots, client, store } = await setup();
    expect(await store.savedTokens('conv-1')).toBeUndefined();
    await prefill(client, 'x'.repeat(400)); // 100 tokens
    await store.saveState(slots, 0, 'conv-1', LIVE);
    expect(await store.savedTokens('conv-1')).toBe(100);
  });

  it('saveState saves the slot and writes a complete manifest', async () => {
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

  it('restoreState restores when everything matches (near-zero prefill afterward)', async () => {
    const { slots, client, store } = await setup();
    const prompt = 'x'.repeat(400);
    await prefill(client, prompt);
    await store.saveState(slots, 0, 'conv-1', LIVE);
    await client.eraseSlot(0); // simulates another conversation that passed through

    const outcome = await store.restoreState(slots, 0, 'conv-1', LIVE);
    expect(outcome).toMatchObject({ restored: true, nRestored: 100 });

    let promptMs = -1;
    for await (const event of client.complete({
      prompt: prompt + 'y'.repeat(8),
      idSlot: 0,
    })) {
      if (event.type === 'done') promptMs = event.stats.promptMs;
    }
    expect(promptMs).toBe(20); // only 2 tokens — the state was indeed restored
  });

  it('refuses the restore when the saved tokens do not fit, WITHOUT touching the server', async () => {
    const { slots, client, store, server } = await setup();
    const prompt = 'x'.repeat(400);
    await prefill(client, prompt);
    await store.saveState(slots, 0, 'conv-1', LIVE);
    await client.eraseSlot(0);

    const outcome = await store.restoreState(slots, 0, 'conv-1', {
      ...LIVE,
      nCtx: 64,
    });
    expect(outcome).toEqual({ restored: false, reason: 'nCtx' });
    expect(server.getSlotTokens(0)).toHaveLength(0); // no restore performed
  });

  it('reports a restore the server refuses, without throwing — the caller re-prefills', async () => {
    // A manifest that matches, but no slot file behind it (another build,
    // a cleaned directory): the server answers 400 and the conversation
    // must simply prefill again, announced — not crash on open.
    const { slots, store, dir } = await setup();
    await writeFile(join(dir, 'conv-1.manifest.json'), JSON.stringify(manifest()), 'utf8');
    const outcome = await store.restoreState(slots, 0, 'conv-1', LIVE);
    expect(outcome).toEqual({ restored: false, reason: 'refused' });
  });

  it('forget removes the slot file and the manifest from the store directory', async () => {
    // Found by the security audit of 2026-08-28: the slot file was removed by
    // its bare NAME, resolved from the process's cwd — never from the store
    // — and `force` swallowed the miss. A forgotten conversation kept its
    // whole prompt on disk, as tokens.
    const { store, dir } = await setup();
    await writeFile(join(dir, 'conv-1.slot'), 'slot bytes', 'utf8');
    await writeFile(join(dir, 'conv-1.manifest.json'), JSON.stringify(manifest()), 'utf8');

    await store.forget('conv-1');

    await expect(readFile(join(dir, 'conv-1.slot'))).rejects.toThrow();
    await expect(readFile(join(dir, 'conv-1.manifest.json'))).rejects.toThrow();
  });

  it('cleanly reports a missing manifest', async () => {
    const { slots, store } = await setup();
    const outcome = await store.restoreState(slots, 0, 'conv-inconnue', LIVE);
    expect(outcome).toEqual({ restored: false, reason: 'missing' });
  });

  it('cleanly reports a corrupted manifest', async () => {
    const { slots, store, dir } = await setup();
    await writeFile(join(dir, 'conv-1.manifest.json'), '{not json', 'utf8');
    const outcome = await store.restoreState(slots, 0, 'conv-1', LIVE);
    expect(outcome).toEqual({ restored: false, reason: 'corrupt' });
  });
});

describe('KvStore — prefix seeds', () => {
  let servers: FakeLlamaServer[] = [];
  let dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers = [];
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs = [];
  });

  async function rig(): Promise<{ slots: SlotApi; client: LlamaCppHttpClient; store: KvStore; dir: string }> {
    const server = await startFakeLlamaServer({ msPerToken: 10, responder: () => '' });
    servers.push(server);
    const dir = await mkdtemp(join(tmpdir(), 'bp-seeds-'));
    dirs.push(dir);
    const client = new LlamaCppHttpClient(server.url);
    const slots: SlotApi = {
      save: (idSlot, filename) => client.saveSlot(idSlot, filename),
      restore: (idSlot, filename) => client.restoreSlot(idSlot, filename),
      erase: (idSlot) => client.eraseSlot(idSlot),
    };
    return { slots, client, store: new KvStore(dir), dir };
  }

  it('keys a seed by the rendered prefix, the model and the cache types — never by n_ctx', () => {
    const store = new KvStore('unused');
    const key = store.seedKey('<system>abc</system>', LIVE);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(store.seedKey('<system>abc</system>', { ...LIVE, nCtx: 1024 })).toBe(key);
    expect(store.seedKey('<system>abd</system>', LIVE)).not.toBe(key);
    expect(store.seedKey('<system>abc</system>', { ...LIVE, modelFingerprint: 'other' })).not.toBe(key);
    expect(store.seedKey('<system>abc</system>', { ...LIVE, cacheTypeK: 'f16', cacheTypeV: 'f16' })).not.toBe(key);
  });

  it('saves a seed from the slot and restores it into an empty one', async () => {
    const { slots, client, store } = await rig();
    const prefix = 'p'.repeat(200);
    for await (const _ of client.complete({ prompt: prefix, idSlot: 0, nPredict: 0 })) { /* prefill */ }
    const key = store.seedKey(prefix, LIVE);

    const manifest = await store.saveSeed(slots, 0, key, LIVE, 50);
    expect(manifest.promptTokenCount).toBe(50);
    await client.eraseSlot(0);

    const outcome = await store.restoreSeed(slots, 0, key, LIVE);
    expect(outcome).toMatchObject({ restored: true, nRestored: 50 });
  });

  it('reports a seed that does not exist, and one that no longer fits', async () => {
    const { slots, store } = await rig();
    expect(await store.restoreSeed(slots, 0, 'nope', LIVE)).toEqual({ restored: false, created: false, reason: 'missing' });
    const key = store.seedKey('x', LIVE);
    await store.saveSeed(slots, 0, key, LIVE, 5000);
    expect(await store.restoreSeed(slots, 0, key, { ...LIVE, nCtx: 1024 })).toEqual({ restored: false, created: false, reason: 'nCtx' });
  });
});
