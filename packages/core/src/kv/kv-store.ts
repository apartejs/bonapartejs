/**
 * kv-store — THE differentiator: orchestrates save/restore of state per
 * conversation with a compatibility manifest.
 *
 * Strict where llama.cpp is blind, tolerant where it checks itself. Read
 * in the source on 2026-08-28 (`llama-context.cpp` state_seq_load_file,
 * `llama-kv-cache.cpp` state_read_meta/data): a restore validates the
 * file's magic and format version, that the saved tokens FIT the slot's
 * context, the layer count, the K/V cell types and row sizes — and never
 * the model's identity, never that n_ctx is the same. So the model file is
 * ours to pin (a sibling fine-tune would load, and answer garbage); n_ctx
 * only has to hold the saved tokens (a context grown since the save
 * restores fine); the K/V types are pinned for a clear message before the
 * server's own; and a build is trusted to refuse a file it cannot read —
 * on which the answer is an announced re-prefill, never a crash.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SlotApi } from '../backend/types.js';
import { enforceRetention, kvUsage, type KvUsage, type RetentionReport } from './retention.js';

export interface LiveBackendConfig {
  /** Fingerprint of the model file (see fingerprintModelFile). */
  modelFingerprint: string;
  nCtx: number;
  cacheTypeK: string;
  cacheTypeV: string;
  /** llama.cpp build tag (e.g. b6521) — recorded for diagnosis, not a key: the server validates its own file format. */
  buildTag: string;
}

export interface KvManifest extends LiveBackendConfig {
  schemaVersion: 1;
  conversationId: string;
  promptTokenCount: number;
  slotFileBytes: number;
  savedAt: string;
}

export type RestoreRefusalReason =
  | 'missing'
  | 'corrupt'
  | 'model'
  /** The saved tokens do not fit the live context. */
  | 'nCtx'
  | 'cacheType'
  /** Kept for old manifests' sake; no longer produced — the server checks the format itself. */
  | 'buildTag'
  /** The server refused the file (unknown format, missing, corrupt): re-prefill. */
  | 'refused';

export type RestoreVerdict =
  | { ok: true }
  | { ok: false; reason: RestoreRefusalReason };

export type RestoreOutcome =
  | { restored: true; manifest: KvManifest; nRestored: number }
  | { restored: false; reason: RestoreRefusalReason };

/**
 * A prefix seed: the rendered system block of a (model, tools, project)
 * prefilled once and saved, so that every conversation starting the same
 * way restores it instead of computing it again. Keyed by the prefix text,
 * the model and the K/V types — not by n_ctx: a seed only has to fit.
 */
export interface SeedManifest extends LiveBackendConfig {
  schemaVersion: 1;
  key: string;
  promptTokenCount: number;
  slotFileBytes: number;
  savedAt: string;
}

export type SeedOutcome =
  /** An existing seed now sits in the slot. */
  | { restored: true; nRestored: number }
  /** No seed existed: the prefix was prefilled and saved for the next conversation. */
  | { restored: false; created: true; nTokens: number }
  /** Nothing restored, nothing created — the reason says why. */
  | { restored: false; created: false; reason: RestoreRefusalReason };

type Restorable = Pick<KvManifest, 'modelFingerprint' | 'promptTokenCount' | 'cacheTypeK' | 'cacheTypeV'>;

export function canRestore(
  manifest: Restorable,
  live: LiveBackendConfig,
): RestoreVerdict {
  if (manifest.modelFingerprint !== live.modelFingerprint) {
    return { ok: false, reason: 'model' };
  }
  // Not "the same n_ctx": the saved tokens must fit. The server checks the
  // very same thing (`cell_count > cells.size()`); this is the early,
  // explained refusal — a state saved under a larger context may well fit.
  if (live.nCtx > 0 && manifest.promptTokenCount > live.nCtx) {
    return { ok: false, reason: 'nCtx' };
  }
  if (
    manifest.cacheTypeK !== live.cacheTypeK ||
    manifest.cacheTypeV !== live.cacheTypeV
  ) {
    return { ok: false, reason: 'cacheType' };
  }
  return { ok: true };
}

export interface KvStoreOptions {
  /**
   * Disk budget for the saved states, read at each save (a live setting).
   * Absent: no retention. After a save, the least recently used other
   * states are evicted until the folder fits (P2.2, D-20).
   */
  budgetBytes?: () => number;
  /** What a save's retention pass did — for a log line or a status. */
  onRetention?: (report: RetentionReport) => void;
}

export class KvStore {
  constructor(
    readonly manifestDir: string,
    private readonly options: KvStoreOptions = {},
  ) {}

  /** What the saved states take on disk. */
  usage(): Promise<KvUsage> {
    return kvUsage(this.manifestDir);
  }

  /** A save or a restore is a use: the slot file's date is what retention sorts on. */
  private async touch(filename: string): Promise<void> {
    const now = new Date();
    await utimes(join(this.manifestDir, filename), now, now).catch(() => undefined);
  }

  /** Brings the folder under the budget, never touching `keep`. */
  private async retain(keep: string[]): Promise<void> {
    const budget = this.options.budgetBytes?.();
    if (budget === undefined || !(budget > 0)) return;
    const report = await enforceRetention(this.manifestDir, budget, keep);
    if (report.evicted.length > 0 || report.overBudget) this.options.onRetention?.(report);
  }

  slotFilename(conversationId: string): string {
    return `${conversationId}.slot`;
  }

  private manifestPath(conversationId: string): string {
    return join(this.manifestDir, `${conversationId}.manifest.json`);
  }

  /**
   * Does state exist for this conversation? Used by the listing: promising
   * an instant resume in the menu with nothing to back it up would be a
   * lie — and that's precisely our product's selling point.
   */
  async has(conversationId: string): Promise<boolean> {
    try {
      await readFile(this.manifestPath(conversationId), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  /** Tokens a conversation's saved state holds — what re-prefilling it would cost; undefined without one. */
  async savedTokens(conversationId: string): Promise<number | undefined> {
    try {
      const manifest = JSON.parse(await readFile(this.manifestPath(conversationId), 'utf8')) as Partial<KvManifest>;
      return typeof manifest.promptTokenCount === 'number' ? manifest.promptTokenCount : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Forgets a conversation's state: the slot file AND its manifest.
   *
   * The KV state is only a CACHE — the append-only log is the truth.
   * Forgetting therefore never loses a message: it only costs an
   * announced re-prefill.
   */
  async forget(conversationId: string): Promise<void> {
    // The slot file lives where the server saves it — the store's directory,
    // which is also the server's --slot-save-path. By its bare name it was
    // being looked for in the process's cwd, and never found (audit, 28/08).
    await rm(join(this.manifestDir, this.slotFilename(conversationId)), { force: true });
    await rm(this.manifestPath(conversationId), { force: true });
  }

  async saveState(
    slots: SlotApi,
    idSlot: number,
    conversationId: string,
    live: LiveBackendConfig,
  ): Promise<KvManifest> {
    const saved = await slots.save(idSlot, this.slotFilename(conversationId));
    const manifest: KvManifest = {
      schemaVersion: 1,
      conversationId,
      promptTokenCount: saved.nSaved,
      slotFileBytes: saved.nWritten,
      savedAt: new Date().toISOString(),
      ...live,
    };
    await mkdir(this.manifestDir, { recursive: true });
    await writeFile(
      this.manifestPath(conversationId),
      JSON.stringify(manifest, null, 2),
      'utf8',
    );
    await this.touch(this.slotFilename(conversationId));
    await this.retain([conversationId]);
    return manifest;
  }

  async restoreState(
    slots: SlotApi,
    idSlot: number,
    conversationId: string,
    live: LiveBackendConfig,
  ): Promise<RestoreOutcome> {
    let raw: string;
    try {
      raw = await readFile(this.manifestPath(conversationId), 'utf8');
    } catch {
      return { restored: false, reason: 'missing' };
    }

    let manifest: KvManifest;
    try {
      manifest = JSON.parse(raw) as KvManifest;
    } catch {
      return { restored: false, reason: 'corrupt' };
    }

    const verdict = canRestore(manifest, live);
    if (!verdict.ok) {
      return { restored: false, reason: verdict.reason };
    }

    // The file is the server's to judge: a format it does not know, a file
    // gone from its directory — it refuses, clears the slot, and the
    // conversation prefills again. Announced, never fatal.
    try {
      const result = await slots.restore(idSlot, this.slotFilename(conversationId));
      await this.touch(this.slotFilename(conversationId));
      return { restored: true, manifest, nRestored: result.nRestored };
    } catch {
      return { restored: false, reason: 'refused' };
    }
  }

  // ── Prefix seeds ─────────────────────────────────────────────────────

  /** Identity of a seed: the rendered prefix, the model, the K/V types. n_ctx is not part of it — a seed only has to fit. */
  seedKey(prefixText: string, live: LiveBackendConfig): string {
    return createHash('sha256')
      .update(live.modelFingerprint)
      .update('\n')
      .update(`${live.cacheTypeK}/${live.cacheTypeV}`)
      .update('\n')
      .update(prefixText)
      .digest('hex')
      .slice(0, 32);
  }

  seedFilename(key: string): string {
    return `seed-${key}.slot`;
  }

  private seedManifestPath(key: string): string {
    return join(this.manifestDir, 'seeds', `${key}.manifest.json`);
  }

  async saveSeed(
    slots: SlotApi,
    idSlot: number,
    key: string,
    live: LiveBackendConfig,
    promptTokenCount: number,
  ): Promise<SeedManifest> {
    const result = await slots.save(idSlot, this.seedFilename(key));
    const manifest: SeedManifest = {
      schemaVersion: 1,
      key,
      ...live,
      promptTokenCount: promptTokenCount > 0 ? promptTokenCount : result.nSaved,
      slotFileBytes: result.nWritten,
      savedAt: new Date().toISOString(),
    };
    await mkdir(join(this.manifestDir, 'seeds'), { recursive: true });
    await writeFile(this.seedManifestPath(key), JSON.stringify(manifest, null, 2), 'utf8');
    await this.touch(this.seedFilename(key));
    await this.retain([]);
    return manifest;
  }

  async restoreSeed(
    slots: SlotApi,
    idSlot: number,
    key: string,
    live: LiveBackendConfig,
  ): Promise<SeedOutcome> {
    let raw: string;
    try {
      raw = await readFile(this.seedManifestPath(key), 'utf8');
    } catch {
      return { restored: false, created: false, reason: 'missing' };
    }
    let manifest: SeedManifest;
    try {
      manifest = JSON.parse(raw) as SeedManifest;
    } catch {
      return { restored: false, created: false, reason: 'corrupt' };
    }
    const verdict = canRestore(manifest, live);
    if (!verdict.ok) return { restored: false, created: false, reason: verdict.reason };
    try {
      const result = await slots.restore(idSlot, this.seedFilename(key));
      await this.touch(this.seedFilename(key));
      return { restored: true, nRestored: result.nRestored };
    } catch {
      return { restored: false, created: false, reason: 'refused' };
    }
  }
}
