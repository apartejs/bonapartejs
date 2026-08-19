/**
 * Persistance des conversations — log JSONL append-only + méta, un dossier
 * par conversation. Le log enregistre TOUT ce qu'il faut pour reconstruire
 * un PromptLog octet-identique (dont le flag thinking de chaque tour).
 */

import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TranscriptEntry } from '../backend/types.js';

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Modèle épinglé à la conversation (chemin GGUF) — pas au backend. */
  modelPath?: string;
  /** Taille de contexte épinglée avec le modèle (entre au manifest KV). */
  nCtx?: number;
  /**
   * État opaque du backend pour cette conversation (llama.cpp y met son
   * prompt système figé). Le reconstruire le ferait varier avec l'inventaire
   * et casserait le préfixe du cache KV.
   */
  backendState?: unknown;
  /** Inventaire d'outils au moment du figeage (base des deltas). */
  toolNames?: string[];
  /**
   * Dossier de projet de CETTE conversation — absent = discussion sans outils
   * disque. Le projet appartient à la conversation, pas à l'application : on
   * doit pouvoir tenir deux conversations sur deux dossiers différents, et
   * changer de projet ne doit pas réécrire l'historique d'une autre.
   */
  projectRoot?: string;
  /**
   * Surcharges de réglages de CETTE conversation — échantillonnage seulement
   * (les paramètres de lancement entrent au manifest KV et restent globaux).
   */
  settings?: Record<string, unknown>;
}

export interface CreateConversationOptions {
  title?: string;
  modelPath?: string;
  nCtx?: number;
  projectRoot?: string;
}

/**
 * Log persisté. Les entrées assistant et résultats d'outils stockent
 * l'entrée de transcript telle quelle (verbatim du fournisseur compris) :
 * c'est ce qui permet de rejouer un rendu octet-identique.
 */
export type ConversationEvent =
  | { type: 'user'; text: string; at: string }
  | {
      type: 'assistant';
      entry: Extract<TranscriptEntry, { role: 'assistant' }>;
      at: string;
    }
  | {
      type: 'tool_results';
      entry: Extract<TranscriptEntry, { role: 'tool_results' }>;
      at: string;
    }
  /** Message de service (delta d'inventaire) : dans le prompt, pas dans l'UI. */
  | { type: 'service'; text: string; at: string };

export class ConversationStore {
  constructor(readonly dir: string) {}

  private convDir(id: string): string {
    return join(this.dir, id);
  }

  private metaPath(id: string): string {
    return join(this.convDir(id), 'meta.json');
  }

  private logPath(id: string): string {
    return join(this.convDir(id), 'log.jsonl');
  }

  async create(
    id: string,
    options: CreateConversationOptions = {},
  ): Promise<ConversationMeta> {
    const now = new Date().toISOString();
    const meta: ConversationMeta = {
      id,
      title: options.title ?? 'Nouvelle conversation',
      createdAt: now,
      updatedAt: now,
      ...(options.modelPath ? { modelPath: options.modelPath } : {}),
      ...(options.nCtx !== undefined ? { nCtx: options.nCtx } : {}),
      ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}),
    };
    await mkdir(this.convDir(id), { recursive: true });
    await writeFile(this.metaPath(id), JSON.stringify(meta, null, 2), 'utf8');
    await writeFile(this.logPath(id), '', 'utf8');
    return meta;
  }

  async meta(id: string): Promise<ConversationMeta> {
    try {
      return await this.readMeta(id);
    } catch {
      throw new Error(`Conversation inconnue : ${id}`);
    }
  }

  /** Rattache (ou remplace) le dossier de projet de la conversation. */
  async setProjectRoot(id: string, projectRoot: string): Promise<void> {
    const meta = await this.meta(id);
    meta.projectRoot = projectRoot;
    meta.updatedAt = new Date().toISOString();
    await writeFile(this.metaPath(id), JSON.stringify(meta, null, 2), 'utf8');
  }

  /** Pose (ou retire, avec `undefined`) une surcharge de réglage. */
  async setSetting(id: string, key: string, value: unknown): Promise<void> {
    const meta = await this.meta(id);
    const settings = { ...(meta.settings ?? {}) };
    if (value === undefined) delete settings[key];
    else settings[key] = value;
    meta.settings = settings;
    meta.updatedAt = new Date().toISOString();
    await writeFile(this.metaPath(id), JSON.stringify(meta, null, 2), 'utf8');
  }

  /** Renomme la conversation (le reste de la méta est préservé). */
  async setTitle(id: string, title: string): Promise<void> {
    const meta = await this.meta(id);
    meta.title = title;
    meta.updatedAt = new Date().toISOString();
    await writeFile(this.metaPath(id), JSON.stringify(meta, null, 2), 'utf8');
  }

  async setModel(id: string, modelPath: string, nCtx?: number): Promise<void> {
    const meta = await this.meta(id);
    meta.modelPath = modelPath;
    if (nCtx !== undefined) meta.nCtx = nCtx;
    await this.writeMeta(meta);
  }

  /** Fige l'état backend et l'inventaire d'outils de la conversation. */
  async freezeBackendState(
    id: string,
    backendState: unknown,
    toolNames: string[],
  ): Promise<void> {
    const meta = await this.meta(id);
    meta.backendState = backendState;
    meta.toolNames = [...toolNames];
    await this.writeMeta(meta);
  }

  /** Met à jour l'inventaire de référence après annonce d'un delta. */
  async setFrozenTools(id: string, toolNames: string[]): Promise<void> {
    const meta = await this.meta(id);
    meta.toolNames = [...toolNames];
    await this.writeMeta(meta);
  }

  private async writeMeta(meta: ConversationMeta): Promise<void> {
    meta.updatedAt = new Date().toISOString();
    await writeFile(this.metaPath(meta.id), JSON.stringify(meta, null, 2), 'utf8');
  }

  async exists(id: string): Promise<boolean> {
    try {
      await readFile(this.metaPath(id), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  private async readMeta(id: string): Promise<ConversationMeta> {
    return JSON.parse(await readFile(this.metaPath(id), 'utf8')) as ConversationMeta;
  }

  async appendEvent(id: string, event: ConversationEvent): Promise<void> {
    await appendFile(this.logPath(id), `${JSON.stringify(event)}\n`, 'utf8');
    const meta = await this.readMeta(id);
    meta.updatedAt = new Date().toISOString();
    await writeFile(this.metaPath(id), JSON.stringify(meta, null, 2), 'utf8');
  }

  async loadEvents(id: string): Promise<ConversationEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.logPath(id), 'utf8');
    } catch {
      throw new Error(`Conversation inconnue : ${id}`);
    }
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ConversationEvent);
  }

  async listMeta(): Promise<ConversationMeta[]> {
    let ids: string[];
    try {
      ids = await readdir(this.dir);
    } catch {
      return [];
    }
    const metas: ConversationMeta[] = [];
    for (const id of ids) {
      try {
        metas.push(await this.readMeta(id));
      } catch {
        // dossier étranger ou méta corrompue : ignoré du listing
      }
    }
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

/**
 * Reconstruit le transcript sémantique depuis les événements persistés.
 * C'est LUI que la boucle et les backends consomment — chaque backend en
 * dérive ensuite sa propre représentation.
 */
export function rebuildTranscript(
  events: ConversationEvent[],
): TranscriptEntry[] {
  return events.map((event): TranscriptEntry => {
    if (event.type === 'assistant') return event.entry;
    if (event.type === 'tool_results') return event.entry;
    if (event.type === 'service') return { role: 'service', text: event.text };
    return { role: 'user', text: event.text };
  });
}
