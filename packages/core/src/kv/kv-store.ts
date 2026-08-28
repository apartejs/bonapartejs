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

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SlotApi } from '../backend/types.js';

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

export function canRestore(
  manifest: KvManifest,
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

export class KvStore {
  constructor(readonly manifestDir: string) {}

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
      return { restored: true, manifest, nRestored: result.nRestored };
    } catch {
      return { restored: false, reason: 'refused' };
    }
  }
}
