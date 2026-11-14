/**
 * What is known of a conversation besides its journal (spec §7.10: the
 * journal is the truth of what was said; this is the card on its folder):
 * title, kind, project, engine and model, mode, marks. `<dir>/<id>/meta.json`,
 * beside the journal's branches, rewritten whole through `writeJsonFile`
 * (never seen half-written), one change at a time per conversation.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { PlayMode } from '@aparte/bonaparte-shared';
import { KeyedQueue, readJsonFile, writeJsonFile } from '../fs/json-file.js';

export interface ConversationMeta {
  id: string;
  /** Empty until the first message names it (task 12.4); the window then says « Nouvelle conversation ». */
  title: string;
  kind: 'code' | 'discussion';
  projectId?: string;
  /** 'builtin', or a provider's id. */
  engineId: string;
  modelId: string;
  mode: PlayMode;
  /** The branch of the journal it shows. */
  branchId: string;
  /** The git branch it works on (task 6.7). */
  branch?: string;
  /** A context smaller than the engine's, for this conversation. */
  contextCap?: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  pinnedAt?: string;
}

export type NewConversation = Pick<ConversationMeta, 'kind' | 'engineId' | 'modelId' | 'mode'> &
  Partial<Pick<ConversationMeta, 'projectId' | 'title'>>;

type Changes = Partial<Omit<ConversationMeta, 'id' | 'createdAt' | 'updatedAt' | 'pinnedAt' | 'archivedAt'>>;
type Marks = Partial<Pick<ConversationMeta, 'pinnedAt' | 'archivedAt'>>;

/** An id becomes a folder name: never a path. */
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function idOf(id: string): string {
  if (!ID.test(id)) throw new Error(`Not a conversation id: ${id}`);
  return id;
}

export class ConversationStore {
  private readonly writes = new KeyedQueue();

  constructor(readonly dir: string) {}

  private metaPath(id: string): string {
    return join(this.dir, idOf(id), 'meta.json');
  }

  /** `id`: the one the window gave it (aparté's client names its conversations); else a new one. */
  async create(input: NewConversation, givenId?: string): Promise<ConversationMeta> {
    const id = givenId === undefined ? `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}` : idOf(givenId);
    const now = new Date().toISOString();
    const meta: ConversationMeta = { title: '', ...input, id, branchId: 'main', createdAt: now, updatedAt: now };
    await mkdir(join(this.dir, id), { recursive: true });
    await this.writes.run(id, () => writeJsonFile(this.metaPath(id), meta));
    return meta;
  }

  async get(id: string): Promise<ConversationMeta | null> {
    const path = this.metaPath(id);
    try {
      return (await readJsonFile(path)) as ConversationMeta;
    } catch {
      return null;
    }
  }

  /** The most recently active first; a folder that is not a conversation is passed over. */
  async list(): Promise<ConversationMeta[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const metas = await Promise.all(names.filter((name) => ID.test(name)).map((name) => this.get(name)));
    return metas
      .filter((meta): meta is ConversationMeta => meta !== null && typeof meta.id === 'string')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async change(id: string, apply: (meta: ConversationMeta) => ConversationMeta): Promise<ConversationMeta> {
    return this.writes.run(idOf(id), async () => {
      const meta = await this.get(id);
      if (!meta) throw new Error(`There is no conversation ${id}.`);
      const next = apply(meta);
      await writeJsonFile(this.metaPath(id), next);
      return next;
    });
  }

  /** A change of what the conversation is: it counts as activity. */
  update(id: string, changes: Changes): Promise<ConversationMeta> {
    return this.change(id, (meta) => ({ ...meta, ...changes, updatedAt: new Date().toISOString() }));
  }

  /** Pinning or archiving is not activity: the order of the list does not move. */
  mark(id: string, marks: Marks): Promise<ConversationMeta> {
    return this.change(id, (meta) => ({ ...meta, ...marks }));
  }

  /** The conversation whole: its card and its journal. */
  async remove(id: string): Promise<void> {
    await this.writes.run(idOf(id), () => rm(join(this.dir, id), { recursive: true, force: true }));
  }
}
