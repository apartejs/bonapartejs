/**
 * kv-store — LE différenciateur : orchestre le save/restore d'état par
 * conversation avec un manifest de compatibilité STRICT. Le format du fichier
 * de slot n'étant pas documenté upstream, un restore n'est autorisé que si
 * le manifest matche exactement l'état vivant du serveur ; sinon re-prefill
 * annoncé — jamais de restore risqué.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SlotApi } from '../backend/types.js';

export interface LiveBackendConfig {
  /** Empreinte du fichier modèle (voir fingerprintModelFile). */
  modelFingerprint: string;
  nCtx: number;
  cacheTypeK: string;
  cacheTypeV: string;
  /** Tag de build llama.cpp (ex. b6521) — 'unknown' ne matche que 'unknown'. */
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
   * Un état existe-t-il pour cette conversation ? Sert au listing : promettre
   * une reprise instantanée dans le menu sans avoir de quoi la tenir serait
   * un mensonge — et c'est justement notre argument produit.
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
   * Oublie l'etat d'une conversation : le fichier de slot ET son manifest.
   *
   * L'etat KV n'est qu'un CACHE — le log append-only est la verite. Oublier ne
   * perd donc jamais un message : ca ne coute qu'un re-prefill, annonce.
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
