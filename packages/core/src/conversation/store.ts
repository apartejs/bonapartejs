/**
 * What is known of a conversation besides its journal (spec §7.10: the
 * journal is the truth of what was said; this is the card on its folder):
 * title, kind, project, engine and model, mode, marks. `<dir>/<id>/meta.json`,
 * beside the journal's branches, rewritten whole through `writeJsonFile`
 * (never seen half-written), one change at a time per conversation.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  /** The git branch it works on (task 6.7): the one asked for, then the one made. */
  branch?: string;
  /** Where it works: the project's folder, or its own branch (made at its first write). */
  worksIn?: 'folder' | 'branch';
  /** What its branch starts from. */
  base?: string;
  /** Its worktree, once its first write made it: the folder it works in from then on. */
  worktree?: string;
  /** A context smaller than the engine's, for this conversation. */
  contextCap?: number;
  /** The project's instructions as the model last read them: a change is appended as a note (task 4.7). */
  instructions?: string;
  /** Its last going back, while it can still be undone — until its next turn begins (task 7.1). */
  rewound?: { what: 'both' | 'conversation' | 'code'; fromBranchId: string; branchId: string; asTurn: string };
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  pinnedAt?: string;
}

export type NewConversation = Pick<ConversationMeta, 'kind' | 'engineId' | 'modelId' | 'mode'> &
  Partial<Pick<ConversationMeta, 'projectId' | 'title'>>;

type Changes = Partial<Omit<ConversationMeta, 'id' | 'createdAt' | 'updatedAt' | 'pinnedAt' | 'archivedAt'>>;
type Marks = Partial<Pick<ConversationMeta, 'pinnedAt' | 'archivedAt'>>;

/** The window's document of a conversation, beside its journal. */
const DOCUMENT = 'aparte.json';
/** The draft of the composer, beside it. */
const DRAFT = 'draft.txt';
const MAX_DRAFT_CHARS = 1024 * 1024;
/** What a conversation's document may weigh: a guard against a page gone wrong, not a limit anyone meets. */
const MAX_DOCUMENT_CHARS = 64 * 1024 * 1024;

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

  /**
   * The conversation under this id, created with `input` if it does not exist
   * yet — once, never overwritten: the page may save its first message before
   * that message's turn reaches the core, and both make sure it exists.
   */
  async ensure(id: string, input: NewConversation): Promise<ConversationMeta> {
    return this.writes.run(idOf(id), async () => {
      const existing = await this.get(id);
      if (existing) return existing;
      const now = new Date().toISOString();
      const meta: ConversationMeta = { title: '', ...input, id, branchId: 'main', createdAt: now, updatedAt: now };
      await mkdir(join(this.dir, id), { recursive: true });
      await writeJsonFile(this.metaPath(id), meta);
      return meta;
    });
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

  /** A new title is not activity either: the person named it, nothing happened in it. */
  rename(id: string, title: string): Promise<ConversationMeta> {
    return this.change(id, (meta) => ({ ...meta, title }));
  }

  /** What the person was writing and has not sent: kept beside the journal; an empty one is forgotten. */
  async saveDraft(id: string, text: string): Promise<void> {
    const path = join(this.dir, idOf(id), DRAFT);
    await this.writes.run(idOf(id), async () => {
      if (text === '') {
        await rm(path, { force: true });
        return;
      }
      if (!(await this.get(id))) throw new Error(`There is no conversation ${id}.`);
      await writeFile(path, text.slice(0, MAX_DRAFT_CHARS), 'utf8');
    });
  }

  async loadDraft(id: string): Promise<string | null> {
    return readFile(join(this.dir, idOf(id), DRAFT), 'utf8').catch(() => null);
  }

  /**
   * The window's document of the conversation (aparté's messages and their
   * tree), kept beside the journal so that the page finds it as it left it.
   * The journal stays the truth of what was said; this is how it was shown.
   */
  async saveDocument(id: string, document: unknown): Promise<void> {
    const text = JSON.stringify(document);
    if (text.length > MAX_DOCUMENT_CHARS) throw new Error(`The document of the conversation ${id} is too big to keep.`);
    await this.writes.run(idOf(id), async () => {
      if (!(await this.get(id))) throw new Error(`There is no conversation ${id}.`);
      await writeJsonFile(join(this.dir, id, DOCUMENT), document);
    });
  }

  async loadDocument(id: string): Promise<unknown> {
    const path = join(this.dir, idOf(id), DOCUMENT);
    try {
      return await readJsonFile(path);
    } catch {
      return null;
    }
  }

  /** The conversation whole: its card and its journal. */
  async remove(id: string): Promise<void> {
    await this.writes.run(idOf(id), () => rm(join(this.dir, id), { recursive: true, force: true }));
  }
}
