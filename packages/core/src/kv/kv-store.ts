/**
 * kv-store — THE differentiator: orchestrates save/restore of state per
 * conversation with a STRICT compatibility manifest. Since the slot file
 * format isn't documented upstream, a restore is only allowed if the
 * manifest matches the server's live state exactly; otherwise an
 * announced re-prefill — never a risky restore.
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
  /** llama.cpp build tag (e.g. b6521) — 'unknown' only matches 'unknown'. */
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
  | 'nCtx'
  | 'cacheType'
  | 'buildTag';

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
  if (manifest.nCtx !== live.nCtx) {
    return { ok: false, reason: 'nCtx' };
  }
  if (
    manifest.cacheTypeK !== live.cacheTypeK ||
    manifest.cacheTypeV !== live.cacheTypeV
  ) {
    return { ok: false, reason: 'cacheType' };
  }
  if (manifest.buildTag !== live.buildTag) {
    return { ok: false, reason: 'buildTag' };
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
    await rm(this.slotFilename(conversationId), { force: true });
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

    const result = await slots.restore(idSlot, this.slotFilename(conversationId));
    return { restored: true, manifest, nRestored: result.nRestored };
  }
}
