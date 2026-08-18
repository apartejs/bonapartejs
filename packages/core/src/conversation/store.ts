/**
 * Persistance des conversations — log JSONL append-only + méta, un dossier
 * par conversation. Le log enregistre TOUT ce qu'il faut pour reconstruire
 * un PromptLog octet-identique (dont le flag thinking de chaque tour).
 */

import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PromptLog } from '../wire/qwen-template.js';

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type ConversationEvent =
  | { type: 'user'; text: string; at: string }
  | { type: 'assistant'; raw: string; thinking: boolean; at: string };

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

  async create(id: string, title = 'Nouvelle conversation'): Promise<ConversationMeta> {
    const now = new Date().toISOString();
    const meta: ConversationMeta = { id, title, createdAt: now, updatedAt: now };
    await mkdir(this.convDir(id), { recursive: true });
    await writeFile(this.metaPath(id), JSON.stringify(meta, null, 2), 'utf8');
    await writeFile(this.logPath(id), '', 'utf8');
    return meta;
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
 * Rejoue les événements dans un PromptLog neuf — DOIT produire un historique
 * gelé octet-identique à celui de la session d'origine (condition du restore).
 */
export function rebuildPromptLog(
  systemPrompt: string,
  events: ConversationEvent[],
): PromptLog {
  const log = new PromptLog(systemPrompt);
  for (const event of events) {
    if (event.type === 'user') {
      log.appendUser(event.text);
    } else {
      log.beginAssistantTurn({ thinking: event.thinking });
      log.completeAssistantTurn(event.raw);
    }
  }
  return log;
}
