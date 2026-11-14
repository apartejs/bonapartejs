/**
 * The KV states of the conversations, and the seeds: a CACHE of the journal.
 * Forgetting one never loses a message — it costs a re-read, announced.
 *
 * Strict where llama.cpp is blind, tolerant where it checks itself (read in
 * its source, 2026-08-28: a restore validates the file's magic and version,
 * that the saved tokens fit the slot's context, the layers, the K/V cell
 * types — never the model's identity, never that n_ctx is the same). So the
 * model file is ours to pin (a sibling fine-tune would load, and answer
 * garbage); n_ctx only has to hold the saved tokens; the K/V types are pinned
 * for a clear reason before the server's; a new build is trusted to refuse a
 * file it cannot read — and a refusal is a re-read announced, never a crash.
 *
 * The slot files live where the server saves them (`--slot-save-path`), which
 * is this store's folder; the manifests sit beside them, the seeds' under
 * `seeds/`. A save or a restore is a use: the slot file's date is what
 * retention sorts on.
 */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, rm, utimes } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { LlamaCppHttpClient } from '../backend/llamacpp/http-client.js';
import { KeyedQueue, readJsonFile, writeJsonFile } from '../fs/json-file.js';

/** What the engine runs now: what a saved state is checked against. */
export interface LiveConfig {
  /** The model file's fingerprint (`kv/fingerprint.ts`). */
  modelFingerprint: string;
  nCtx: number;
  cacheTypeK: string;
  cacheTypeV: string;
  /** Recorded for diagnosis, never compared: the server reads its own format. */
  buildTag?: string;
}

export type RestoreRefusal = 'missing' | 'other-model' | 'cache-types' | 'context-too-small' | 'refused';

export type RestoreVerdict = { ok: true } | { ok: false; reason: 'other-model' | 'cache-types' | 'context-too-small' };

interface Pinned {
  modelFingerprint: string;
  promptTokenCount: number;
  cacheTypeK: string;
  cacheTypeV: string;
}

export interface KvManifest extends Pinned {
  schemaVersion: 2;
  stateId: string;
  nCtx: number;
  buildTag?: string;
  slotFileBytes: number;
  savedAt: string;
}

export interface SeedManifest extends Pinned {
  schemaVersion: 2;
  key: string;
  nCtx: number;
  buildTag?: string;
  slotFileBytes: number;
  savedAt: string;
  /** How many conversations it served. */
  served: number;
  /** How long its last restore took; null until it served one. */
  restoreMs: number | null;
}

export type RestoreOutcome =
  /** `restoreMs`: what the person waited — the server's read and the round trip. */
  | { restored: true; manifest: KvManifest; nRestored: number; restoreMs: number }
  | { restored: false; reason: RestoreRefusal };

export type SeedOutcome = { restored: true; nRestored: number; restoreMs: number } | { restored: false; reason: RestoreRefusal };

export interface SeedStats {
  tokens: number;
  restoreMs: number | null;
  served: number;
}

/** What the store asks of the server. */
export type KvSlots = Pick<LlamaCppHttpClient, 'saveSlot' | 'restoreSlot'>;

export function canRestore(manifest: Pinned, live: LiveConfig): RestoreVerdict {
  if (manifest.modelFingerprint !== live.modelFingerprint) return { ok: false, reason: 'other-model' };
  // Not "the same n_ctx": the saved tokens must fit — what the server checks too, said earlier and clearly.
  if (live.nCtx > 0 && manifest.promptTokenCount > live.nCtx) return { ok: false, reason: 'context-too-small' };
  if (manifest.cacheTypeK !== live.cacheTypeK || manifest.cacheTypeV !== live.cacheTypeV) {
    return { ok: false, reason: 'cache-types' };
  }
  return { ok: true };
}

/** A state id becomes a file name: letters, digits, `-` and `_` only. */
const STATE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;
const SEED_KEY = /^[0-9a-f]{32}$/;

function stateIdOf(id: string): string {
  if (!STATE_ID.test(id)) throw new Error(`Not a state id: ${id}`);
  return id;
}

function seedKeyOf(key: string): string {
  if (!SEED_KEY.test(key)) throw new Error(`Not a seed key: ${key}`);
  return key;
}

async function readManifest<T>(path: string): Promise<T | null> {
  try {
    return (await readJsonFile(path)) as T;
  } catch {
    // Absent, or unreadable: there is no state to trust.
    return null;
  }
}

export class KvStore {
  private readonly manifests = new KeyedQueue();

  constructor(readonly dir: string) {
    if (!isAbsolute(dir)) throw new Error(`The folder of the KV states must be an absolute path: ${dir}`);
  }

  slotFilename(stateId: string): string {
    return `${stateIdOf(stateId)}.slot`;
  }

  private manifestPath(stateId: string): string {
    return join(this.dir, `${stateIdOf(stateId)}.manifest.json`);
  }

  seedFilename(key: string): string {
    return `seed-${seedKeyOf(key)}.slot`;
  }

  private seedManifestPath(key: string): string {
    return join(this.dir, 'seeds', `${seedKeyOf(key)}.manifest.json`);
  }

  private async touch(filename: string): Promise<void> {
    const now = new Date();
    await utimes(join(this.dir, filename), now, now).catch(() => undefined);
  }

  /** Is there a state to promise an instant resume with? */
  async has(stateId: string): Promise<boolean> {
    return (await readManifest(this.manifestPath(stateId))) !== null;
  }

  /** The tokens a state holds — what re-reading it would cost; undefined without one. */
  async savedTokens(stateId: string): Promise<number | undefined> {
    return (await readManifest<KvManifest>(this.manifestPath(stateId)))?.promptTokenCount;
  }

  /** The slot file and its manifest, in this folder only. */
  async forget(stateId: string): Promise<void> {
    await rm(join(this.dir, this.slotFilename(stateId)), { force: true });
    await rm(this.manifestPath(stateId), { force: true });
  }

  /**
   * A branch gets the state of the one it comes from (a reflink where the
   * disk can): its prompt starts with the other's, byte for byte, and the
   * server keeps the common part. False when there is no state to give.
   */
  async copyState(fromId: string, toId: string): Promise<boolean> {
    const manifest = await readManifest<KvManifest>(this.manifestPath(fromId));
    if (!manifest) return false;
    try {
      await copyFile(join(this.dir, this.slotFilename(fromId)), join(this.dir, this.slotFilename(toId)), constants.COPYFILE_FICLONE);
    } catch {
      return false;
    }
    await writeJsonFile(this.manifestPath(toId), { ...manifest, stateId: toId, savedAt: new Date().toISOString() });
    await this.touch(this.slotFilename(toId));
    return true;
  }

  async saveState(slots: KvSlots, idSlot: number, stateId: string, live: LiveConfig): Promise<KvManifest> {
    const saved = await slots.saveSlot(idSlot, this.slotFilename(stateId));
    await mkdir(this.dir, { recursive: true });
    const manifest: KvManifest = {
      schemaVersion: 2,
      stateId,
      ...live,
      promptTokenCount: saved.nSaved,
      slotFileBytes: saved.nWritten,
      savedAt: new Date().toISOString(),
    };
    await writeJsonFile(this.manifestPath(stateId), manifest);
    await this.touch(this.slotFilename(stateId));
    return manifest;
  }

  async restoreState(slots: KvSlots, idSlot: number, stateId: string, live: LiveConfig): Promise<RestoreOutcome> {
    const manifest = await readManifest<KvManifest>(this.manifestPath(stateId));
    if (!manifest) return { restored: false, reason: 'missing' };
    const verdict = canRestore(manifest, live);
    if (!verdict.ok) return { restored: false, reason: verdict.reason };
    try {
      const started = performance.now();
      const result = await slots.restoreSlot(idSlot, this.slotFilename(stateId));
      const restoreMs = performance.now() - started;
      await this.touch(this.slotFilename(stateId));
      return { restored: true, manifest, nRestored: result.nRestored, restoreMs };
    } catch {
      return { restored: false, reason: 'refused' };
    }
  }

  // ── Seeds: the first system turn of a kind of conversation ──

  /** A seed's identity: the model, the K/V types, the text of the prefix — not n_ctx: a seed only has to fit. */
  seedKey(prefixText: string, live: LiveConfig): string {
    return createHash('sha256')
      .update(live.modelFingerprint)
      .update('\n')
      .update(`${live.cacheTypeK}/${live.cacheTypeV}`)
      .update('\n')
      .update(prefixText)
      .digest('hex')
      .slice(0, 32);
  }

  /** Saves what the slot holds — the prefix, prefilled — as the seed `key`. */
  async saveSeed(slots: KvSlots, idSlot: number, key: string, live: LiveConfig): Promise<SeedManifest> {
    const saved = await slots.saveSlot(idSlot, this.seedFilename(key));
    const manifest: SeedManifest = {
      schemaVersion: 2,
      key,
      ...live,
      promptTokenCount: saved.nSaved,
      slotFileBytes: saved.nWritten,
      savedAt: new Date().toISOString(),
      served: 0,
      restoreMs: null,
    };
    await mkdir(join(this.dir, 'seeds'), { recursive: true });
    await this.manifests.run(key, () => writeJsonFile(this.seedManifestPath(key), manifest));
    await this.touch(this.seedFilename(key));
    return manifest;
  }

  async restoreSeed(slots: KvSlots, idSlot: number, key: string, live: LiveConfig): Promise<SeedOutcome> {
    const manifest = await readManifest<SeedManifest>(this.seedManifestPath(key));
    if (!manifest) return { restored: false, reason: 'missing' };
    const verdict = canRestore(manifest, live);
    if (!verdict.ok) return { restored: false, reason: verdict.reason };
    let nRestored: number;
    const started = performance.now();
    try {
      nRestored = (await slots.restoreSlot(idSlot, this.seedFilename(key))).nRestored;
    } catch {
      return { restored: false, reason: 'refused' };
    }
    const restoreMs = performance.now() - started;
    await this.touch(this.seedFilename(key));
    await this.manifests.run(key, async () => {
      const current = await readManifest<SeedManifest>(this.seedManifestPath(key));
      if (current) await writeJsonFile(this.seedManifestPath(key), { ...current, served: current.served + 1, restoreMs });
    });
    return { restored: true, nRestored, restoreMs };
  }

  /** What a seed holds, how long it takes back, how many conversations it served; null without one. */
  async seedStats(key: string): Promise<SeedStats | null> {
    const manifest = await readManifest<SeedManifest>(this.seedManifestPath(key));
    return manifest ? { tokens: manifest.promptTokenCount, restoreMs: manifest.restoreMs, served: manifest.served } : null;
  }
}
