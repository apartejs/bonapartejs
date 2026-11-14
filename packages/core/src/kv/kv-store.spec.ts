/**
 * The KV states: a cache of the journal, saved and restored with a manifest
 * that pins what llama.cpp does not check itself (the model file, the K/V
 * types), lets the context grow, and never makes a refusal fatal. Seeds:
 * the first system turn of a kind of conversation, prefilled once and
 * restored by every conversation that starts the same way.
 */

import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LlamaCppHttpClient } from '../backend/llamacpp/http-client.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';
import { canRestore, KvStore, type LiveConfig } from './kv-store.js';

const LIVE: LiveConfig = { modelFingerprint: 'fp-gemma', nCtx: 8192, cacheTypeK: 'f16', cacheTypeV: 'f16' };

let servers: FakeLlamaServer[] = [];
let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  servers = [];
  dirs = [];
});

async function rig() {
  const dir = await mkdtemp(join(tmpdir(), 'bp-kv-'));
  dirs.push(dir);
  const server = await startFakeLlamaServer({ slotDir: dir, msPerToken: 2 });
  servers.push(server);
  const client = new LlamaCppHttpClient(server.url);
  const prefill = async (prompt: string): Promise<number> => {
    for await (const event of client.complete({ prompt, idSlot: 0, nPredict: 0 })) {
      if (event.type === 'done') return event.stats.promptUncachedTokens;
    }
    throw new Error('no done event');
  };
  return { dir, server, client, store: new KvStore(dir), prefill };
}

const PROMPT = Array.from({ length: 300 }, (_, n) => `word${n}`).join(' ');

describe('canRestore', () => {
  const saved = { modelFingerprint: 'fp-gemma', promptTokenCount: 4000, cacheTypeK: 'f16', cacheTypeV: 'f16' } as const;

  it('accepts a state saved with the same model and K/V types', () => {
    expect(canRestore(saved, LIVE)).toEqual({ ok: true });
  });

  it('lets the context grow: the saved tokens only have to fit', () => {
    expect(canRestore(saved, { ...LIVE, nCtx: 32768 })).toEqual({ ok: true });
    expect(canRestore(saved, { ...LIVE, nCtx: 2048 })).toEqual({ ok: false, reason: 'context-too-small' });
  });

  it('refuses another model, or other K/V types', () => {
    expect(canRestore(saved, { ...LIVE, modelFingerprint: 'fp-other' })).toEqual({ ok: false, reason: 'other-model' });
    expect(canRestore(saved, { ...LIVE, cacheTypeV: 'q8_0' })).toEqual({ ok: false, reason: 'cache-types' });
  });

  it('a new build of llama.cpp alone refuses nothing: the server reads its own format', () => {
    expect(canRestore({ ...saved, buildTag: 'b10217' } as typeof saved, { ...LIVE, buildTag: 'b12383' })).toEqual({ ok: true });
  });
});

describe('KvStore', () => {
  it('saves a state with its manifest, and restoring it serves the prefix from the cache', async () => {
    const { store, client, prefill } = await rig();
    await prefill(PROMPT);
    const manifest = await store.saveState(client, 0, 'c1_main', LIVE);
    expect(manifest).toMatchObject({ stateId: 'c1_main', modelFingerprint: 'fp-gemma', cacheTypeK: 'f16' });
    expect(manifest.promptTokenCount).toBeGreaterThan(250);
    expect(await store.savedTokens('c1_main')).toBe(manifest.promptTokenCount);

    await client.eraseSlot(0);
    const restored = await store.restoreState(client, 0, 'c1_main', LIVE);
    expect(restored).toMatchObject({ restored: true, nRestored: manifest.promptTokenCount });
    // Only what follows the restored prefix is evaluated.
    expect(await prefill(`${PROMPT} and more`)).toBeLessThan(10);
  });

  it('says why it does not restore: nothing saved, a manifest that does not read, another model', async () => {
    const { store, client, prefill, dir } = await rig();
    expect(await store.restoreState(client, 0, 'c1_main', LIVE)).toEqual({ restored: false, reason: 'missing' });
    await prefill(PROMPT);
    await store.saveState(client, 0, 'c1_main', LIVE);
    expect(await store.restoreState(client, 0, 'c1_main', { ...LIVE, modelFingerprint: 'x' })).toEqual({
      restored: false,
      reason: 'other-model',
    });
    await writeFile(join(dir, 'c1_main.manifest.json'), '{ broken');
    expect(await store.restoreState(client, 0, 'c1_main', LIVE)).toEqual({ restored: false, reason: 'missing' });
  });

  it('a state the server refuses is a re-read announced, never a crash', async () => {
    const { store, client, dir } = await rig();
    // A manifest whose slot file the server never wrote (deleted by hand, or another build's).
    const manifest = { schemaVersion: 2, stateId: 'c1_main', ...LIVE, promptTokenCount: 300, slotFileBytes: 1, savedAt: '' };
    await writeFile(join(dir, 'c1_main.manifest.json'), JSON.stringify(manifest));
    expect(await store.restoreState(client, 0, 'c1_main', LIVE)).toEqual({ restored: false, reason: 'refused' });
  });

  it('forgets a state — its slot file and its manifest — in its own folder only', async () => {
    const { store, client, prefill, dir } = await rig();
    await prefill(PROMPT);
    await store.saveState(client, 0, 'c1_main', LIVE);
    await store.forget('c1_main');
    expect((await readdir(dir)).filter((name) => name.startsWith('c1_main'))).toEqual([]);
    await expect(store.forget('../c1_main')).rejects.toThrow(/state id/);
  });

  it('refuses a folder given as a relative path: a deletion never accepts one', () => {
    expect(() => new KvStore('kv-slots')).toThrow(/absolute/);
  });

  it('gives a branch the state of the one it comes from', async () => {
    const { store, client, prefill } = await rig();
    await prefill(PROMPT);
    await store.saveState(client, 0, 'c1_main', LIVE);
    expect(await store.copyState('c1_main', 'c1_b-1234')).toBe(true);
    expect(await store.restoreState(client, 0, 'c1_b-1234', LIVE)).toMatchObject({ restored: true });
    expect(await store.copyState('c1_none', 'c1_b-5678')).toBe(false);
  });
});

describe('KvStore — seeds', () => {
  it('keys a seed by the model, the K/V types and the text of the prefix — not by the context', () => {
    const store = new KvStore(join(tmpdir(), 'bp-kv-keys'));
    const key = store.seedKey('<|turn>system\nYou are bonaparte.<turn|>\n', LIVE);
    expect(store.seedKey('<|turn>system\nYou are bonaparte.<turn|>\n', { ...LIVE, nCtx: 32768 })).toBe(key);
    expect(store.seedKey('<|turn>system\nYou are someone.<turn|>\n', LIVE)).not.toBe(key);
    expect(store.seedKey('<|turn>system\nYou are bonaparte.<turn|>\n', { ...LIVE, modelFingerprint: 'x' })).not.toBe(key);
    expect(store.seedKey('<|turn>system\nYou are bonaparte.<turn|>\n', { ...LIVE, cacheTypeK: 'q8_0' })).not.toBe(key);
  });

  it('a seed saved by one conversation serves the next, and says how many it served', async () => {
    const { store, client, prefill } = await rig();
    const key = store.seedKey(PROMPT, LIVE);
    expect(await store.restoreSeed(client, 0, key, LIVE)).toEqual({ restored: false, reason: 'missing' });
    expect(await store.seedStats(key)).toBeNull();

    await prefill(PROMPT);
    await store.saveSeed(client, 0, key, LIVE);
    expect(await store.seedStats(key)).toMatchObject({ served: 0, restoreMs: null });

    for (const _ of [1, 2]) {
      await client.eraseSlot(0);
      expect(await store.restoreSeed(client, 0, key, LIVE)).toMatchObject({ restored: true });
      expect(await prefill(`${PROMPT} Bonjour`)).toBeLessThan(10);
    }
    const stats = await store.seedStats(key);
    expect(stats).toMatchObject({ served: 2 });
    expect(stats!.tokens).toBeGreaterThan(250);
    expect(stats!.restoreMs).toBeGreaterThanOrEqual(0);
  });
});

describe('KvStore — under a disk budget', () => {
  it('makes room before it saves, from what the state will weigh — keeping the one about to be restored', async () => {
    const { dir, client, prefill } = await rig();
    const store = new KvStore(dir, { budgetBytes: () => 10_000 });
    for (const id of ['old', 'next']) {
      await writeFile(join(dir, `${id}.slot`), Buffer.alloc(4_000));
      await writeFile(join(dir, `${id}.manifest.json`), '{}');
    }
    await prefill(PROMPT);
    await store.saveState(client, 0, 'c1_main', LIVE, { expectedBytes: 3_000, keep: ['next'] });
    const names = await readdir(dir);
    expect(names).toContain('c1_main.slot');
    expect(names).toContain('next.slot');
    expect(names).not.toContain('old.slot');
  });

  it('refuses aloud a state bigger than the whole budget, and asks the server for nothing', async () => {
    const { dir } = await rig();
    const store = new KvStore(dir, { budgetBytes: () => 1_000 });
    const asked: string[] = [];
    const slots = {
      saveSlot: async (_id: number, filename: string) => {
        asked.push(filename);
        return { idSlot: 0, filename, nSaved: 1, nWritten: 1, saveMs: 0 };
      },
      restoreSlot: async () => {
        throw new Error('not here');
      },
    };
    await expect(store.saveState(slots, 0, 'c1_main', LIVE, { expectedBytes: 5_000 })).rejects.toThrow(/does not fit/);
    expect(asked).toEqual([]);
  });

  it('a save that fails — a full disk — says so, and leaves no manifest behind', async () => {
    const { dir } = await rig();
    const store = new KvStore(dir);
    const slots = {
      saveSlot: async () => {
        throw new Error('failed to write the slot file: no space left on device');
      },
      restoreSlot: async () => {
        throw new Error('not here');
      },
    };
    await expect(store.saveState(slots, 0, 'c1_main', LIVE)).rejects.toThrow(/no space left/);
    expect(await store.has('c1_main')).toBe(false);
  });
});

describe('KvStore — reading a manifest', () => {
  it('gives the manifest of a saved state, and null without one', async () => {
    const { store, client, prefill } = await rig();
    expect(await store.manifest('c1_main')).toBeNull();
    await prefill(PROMPT);
    const saved = await store.saveState(client, 0, 'c1_main', LIVE);
    expect(await store.manifest('c1_main')).toEqual(saved);
  });
});

