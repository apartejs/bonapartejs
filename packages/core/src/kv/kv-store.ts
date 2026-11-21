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
 * The KV streams are pinned too (the real smoke of 2026-11-21): llama.cpp
 * refuses a file saved under another number of slots, as « Unable to restore
 * slot », which said nothing of why — and the restart said nothing of it.
 *
 * The slot files live where the server saves them (`--slot-save-path`), which
 * is this store's folder; the manifests sit beside them, the seeds' under
 * `seeds/`. A save or a restore is a use: the slot file's date is what
 * retention sorts on.
 */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, open, rm, utimes, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { LlamaCppHttpClient } from '../backend/llamacpp/http-client.js';
import { KeyedQueue, readJsonFile, writeJsonFile } from '../fs/json-file.js';
import { enforceRetention, kvUsage, type EvictionNote, type KvUsage, type RetentionReport } from './retention.js';

/** What the engine runs now: what a saved state is checked against. */
export interface LiveConfig {
  /** The model file's fingerprint (`kv/fingerprint.ts`). */
  modelFingerprint: string;
  nCtx: number;
  cacheTypeK: string;
  cacheTypeV: string;
  /**
   * The streams of the server's KV cache (absent: one). llama.cpp keeps one a slot unless `--kv-unified`, which
   * bonaparte never passes (llama-kv-cache.cpp: `n_stream = unified ? 1 : n_seq_max`); it writes the count at the
   * head of every slot file and refuses a file of another (« n_stream mismatch »), both ways.
   */
  kvStreams?: number;
  /** Recorded for diagnosis, never compared: the server reads its own format. */
  buildTag?: string;
}

export type RestoreRefusal = 'missing' | 'other-model' | 'cache-types' | 'context-too-small' | 'slots' | 'refused';

export type RestoreVerdict = { ok: true } | { ok: false; reason: 'other-model' | 'cache-types' | 'context-too-small' | 'slots' };

interface Pinned {
  modelFingerprint: string;
  promptTokenCount: number;
  cacheTypeK: string;
  cacheTypeV: string;
  /**
   * Absent from a manifest written before the count was recorded (2026-11-21): read once from the slot file and
   * written into the manifest (`streamsInSlotFile`); one when the file does not say.
   */
  kvStreams?: number;
}

/** The KV streams a state was saved under, or a server runs: one when not said. */
const streamsOf = (config: { kvStreams?: number }): number => config.kvStreams ?? 1;

/** « ggsq »: the head of a file of llama.cpp's `llama_state_seq_save_file` (LLAMA_STATE_SEQ_MAGIC). */
const STATE_SEQ_MAGIC = 0x67677371;

/**
 * The KV streams llama.cpp wrote in a slot file, or undefined when the file does not say (absent, or not
 * llama.cpp's). `llama_state_seq_save_file` writes three u32 — the magic, the version, the count of the u32 the
 * server packed (its tokens and a header of its own: not the tokens the save reported) —, those u32, then the
 * memory's state, whose first u32 is the number of streams (llama-kv-cache.cpp `state_write`; b11558 read, b12383
 * checked on a real slot file under one and two slots, 2026-11-21).
 */
export async function streamsInSlotFile(path: string): Promise<number | undefined> {
  let file;
  try {
    file = await open(path, 'r');
    const head = Buffer.alloc(12);
    if ((await file.read(head, 0, 12, 0)).bytesRead < 12 || head.readUInt32LE(0) !== STATE_SEQ_MAGIC) return undefined;
    const field = Buffer.alloc(4);
    if ((await file.read(field, 0, 4, 12 + 4 * head.readUInt32LE(8))).bytesRead < 4) return undefined;
    const streams = field.readUInt32LE(0);
    // A slot a stream, or one for them all: anything else is not a count this reader knows.
    return streams >= 1 && streams <= 256 ? streams : undefined;
  } catch {
    return undefined;
  } finally {
    await file?.close().catch(() => undefined);
  }
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

export interface KvStoreOptions {
  /** The disk budget, read at each save (a live setting); absent: no retention. */
  budgetBytes?: () => number;
  /** What a save's retention did: for the log, and the « Moteur et mémoire » page. */
  onRetention?: (report: RetentionReport) => void;
}

/** What a save will weigh, and what must survive it besides the state saved. */
export interface SavePlan {
  /** Tokens × bytes per token: room is made for it before writing. */
  expectedBytes?: number;
  /** The state about to be restored, never evicted to make room. */
  keep?: readonly string[];
}

export function canRestore(manifest: Pinned, live: LiveConfig): RestoreVerdict {
  if (manifest.modelFingerprint !== live.modelFingerprint) return { ok: false, reason: 'other-model' };
  // Not "the same n_ctx": the saved tokens must fit — what the server checks too, said earlier and clearly.
  if (live.nCtx > 0 && manifest.promptTokenCount > live.nCtx) return { ok: false, reason: 'context-too-small' };
  if (manifest.cacheTypeK !== live.cacheTypeK || manifest.cacheTypeV !== live.cacheTypeV) {
    return { ok: false, reason: 'cache-types' };
  }
  // What llama.cpp checks too, but answers only as « Unable to restore slot »: said before it is asked, and why.
  if (streamsOf(manifest) !== streamsOf(live)) return { ok: false, reason: 'slots' };
  return { ok: true };
}

/**
 * The memories saved that launch settings would refuse (task 7.4: a setting that restarts the engine says it
 * first): another K/V cache type refuses them all; a smaller context, those whose tokens no longer fit; another
 * number of slots (`slots`, absent: one), those saved under the other count — one KV stream a slot.
 */
export function memoriesRefusedBy(memories: readonly Pinned[], next: { nCtx: number; cacheType: string; slots?: number }): number {
  return memories.filter(
    (memory) =>
      memory.cacheTypeK !== next.cacheType ||
      memory.cacheTypeV !== next.cacheType ||
      memory.promptTokenCount > next.nCtx ||
      streamsOf(memory) !== (next.slots ?? 1),
  ).length;
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

  constructor(
    readonly dir: string,
    private readonly options: KvStoreOptions = {},
  ) {
    if (!isAbsolute(dir)) throw new Error(`The folder of the KV states must be an absolute path: ${dir}`);
  }

  /** Room for what is about to be written, before it is: the least recently used go, never `keep`. */
  private async makeRoom(keep: readonly string[], plan: SavePlan, replacing?: string): Promise<void> {
    const budget = this.options.budgetBytes?.();
    if (budget === undefined || !(budget > 0)) return;
    const kept = [...keep, ...(plan.keep ?? []).map(stateIdOf)];
    const report = await enforceRetention(this.dir, budget, kept, plan.expectedBytes ?? 0, replacing);
    if (report.evicted.length > 0 || report.overBudget) this.options.onRetention?.(report);
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

  /** What the states and the seeds take on disk. */
  usage(): Promise<KvUsage> {
    return kvUsage(this.dir);
  }

  /** The manifests of every conversation's state saved (not the seeds). */
  async savedStates(): Promise<KvManifest[]> {
    const { entries } = await this.usage();
    const read = await Promise.all(entries.filter((entry) => entry.kind === 'state').map((entry) => this.manifest(entry.id)));
    return read.filter((manifest): manifest is KvManifest => manifest !== null);
  }

  /** A saved state's manifest — what opening it will cost; null without one. */
  async manifest(stateId: string): Promise<KvManifest | null> {
    const path = this.manifestPath(stateId);
    return this.withStreams(await readManifest<KvManifest>(path), this.slotFilename(stateId), path, `state:${stateId}`);
  }

  /**
   * A manifest written before the KV streams were recorded (2026-11-21) says nothing of them; the slot file does,
   * read once and written into the manifest (review of 2026-11-21). Read as one slot, a state saved under « En
   * parallèle » then was promised as a restore under one slot — and read again in silence when llama.cpp refused
   * it —, and refused under two although llama.cpp would load it. A file that does not say stays at one.
   */
  private async withStreams<T extends Pinned>(manifest: T | null, slotFile: string, path: string, queueKey: string): Promise<T | null> {
    if (!manifest || manifest.kvStreams !== undefined) return manifest;
    const kvStreams = await streamsInSlotFile(join(this.dir, slotFile));
    if (kvStreams === undefined) return manifest;
    await this.manifests
      .run(queueKey, async () => {
        // Saved again meanwhile: that manifest says its own count.
        const current = await readManifest<T>(path);
        if (current && current.kvStreams === undefined) await writeJsonFile(path, { ...current, kvStreams });
      })
      .catch(() => undefined);
    return { ...manifest, kvStreams };
  }

  /** The tokens a state holds — what re-reading it would cost; undefined without one. */
  async savedTokens(stateId: string): Promise<number | undefined> {
    return (await readManifest<KvManifest>(this.manifestPath(stateId)))?.promptTokenCount;
  }

  /**
   * « Libérer » (Settings, Engine and memory): the person lets a saved state go. It leaves the note a
   * budget's eviction leaves, said as the person's, so that reopening the conversation says why.
   */
  async release(stateId: string): Promise<void> {
    await this.forget(stateId);
    const note: EvictionNote = { at: new Date().toISOString(), budgetBytes: this.options.budgetBytes?.() ?? 0, byPerson: true };
    await writeFile(this.evictionPath(stateId), JSON.stringify(note));
  }

  /** The slot file and its manifest, in this folder only. */
  async forget(stateId: string): Promise<void> {
    await rm(join(this.dir, this.slotFilename(stateId)), { force: true });
    await rm(this.manifestPath(stateId), { force: true });
    await rm(this.evictionPath(stateId), { force: true });
  }

  /**
   * A branch gets the state of the one it comes from (a reflink where the
   * disk can): its prompt starts with the other's, byte for byte, and the
   * server keeps the common part. False when there is no state to give.
   */
  async copyState(fromId: string, toId: string): Promise<boolean> {
    const manifest = await this.manifest(fromId);
    if (!manifest) return false;
    try {
      await copyFile(join(this.dir, this.slotFilename(fromId)), join(this.dir, this.slotFilename(toId)), constants.COPYFILE_FICLONE);
    } catch {
      return false;
    }
    // The copy holds what the original held, from when it was saved: its age goes with it.
    await writeJsonFile(this.manifestPath(toId), { ...manifest, stateId: toId });
    await this.touch(this.slotFilename(toId));
    return true;
  }

  async saveState(slots: KvSlots, idSlot: number, stateId: string, live: LiveConfig, plan: SavePlan = {}): Promise<KvManifest> {
    await this.makeRoom([stateIdOf(stateId)], plan, stateIdOf(stateId));
    const saved = await slots.saveSlot(idSlot, this.slotFilename(stateId));
    await mkdir(this.dir, { recursive: true });
    const manifest: KvManifest = {
      schemaVersion: 2,
      stateId,
      ...live,
      kvStreams: streamsOf(live),
      promptTokenCount: saved.nSaved,
      slotFileBytes: saved.nWritten,
      savedAt: new Date().toISOString(),
    };
    await this.manifests.run(`state:${stateId}`, () => writeJsonFile(this.manifestPath(stateId), manifest));
    await this.touch(this.slotFilename(stateId));
    await rm(this.evictionPath(stateId), { force: true });
    return manifest;
  }

  /** When a state was let go to stay under the budget, and which budget; null if it was not (or was saved since). */
  async evicted(stateId: string): Promise<EvictionNote | null> {
    const note = await readManifest<Partial<EvictionNote>>(this.evictionPath(stateId));
    return note && typeof note.at === 'string' && typeof note.budgetBytes === 'number'
      ? { at: note.at, budgetBytes: note.budgetBytes, ...(note.byPerson === true ? { byPerson: true as const } : {}) }
      : null;
  }

  private evictionPath(stateId: string): string {
    return join(this.dir, `${stateIdOf(stateId)}.evicted.json`);
  }

  async restoreState(slots: KvSlots, idSlot: number, stateId: string, live: LiveConfig): Promise<RestoreOutcome> {
    const manifest = await this.manifest(stateId);
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

  /**
   * A seed's identity: the model, the K/V types, the KV streams, the text of the prefix — not n_ctx: a seed only
   * has to fit. One stream adds nothing to the key, which stays the one its seeds were saved under before the
   * count was recorded; two slots have a seed of their own, so going back and forth never writes one over the other.
   */
  seedKey(prefixText: string, live: LiveConfig): string {
    const streams = streamsOf(live);
    return createHash('sha256')
      .update(live.modelFingerprint)
      .update('\n')
      .update(`${live.cacheTypeK}/${live.cacheTypeV}${streams === 1 ? '' : `/${streams} streams`}`)
      .update('\n')
      .update(prefixText)
      .digest('hex')
      .slice(0, 32);
  }

  /** Saves what the slot holds — the prefix, prefilled — as the seed `key`. */
  async saveSeed(slots: KvSlots, idSlot: number, key: string, live: LiveConfig, plan: SavePlan = {}): Promise<SeedManifest> {
    await this.makeRoom([], plan);
    const saved = await slots.saveSlot(idSlot, this.seedFilename(key));
    const manifest: SeedManifest = {
      schemaVersion: 2,
      key,
      ...live,
      kvStreams: streamsOf(live),
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
    const path = this.seedManifestPath(key);
    const manifest = await this.withStreams(await readManifest<SeedManifest>(path), this.seedFilename(key), path, key);
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
