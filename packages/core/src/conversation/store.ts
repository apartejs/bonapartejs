/**
 * Conversation persistence — append-only JSONL log + meta, one folder per
 * conversation. The log records EVERYTHING needed to reconstruct a
 * byte-identical PromptLog (including the thinking flag of each turn).
 */

import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TranscriptEntry } from '../backend/types.js';

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Model pinned to the conversation (GGUF path) — not to the backend. */
  modelPath?: string;
  /** Context size pinned with the model (goes into the KV manifest). */
  nCtx?: number;
  /**
   * Opaque backend state for this conversation (llama.cpp puts its frozen
   * system prompt there). Rebuilding it would make it vary with the
   * inventory and would break the KV cache prefix.
   */
  backendState?: unknown;
  /** Tool inventory at freeze time (basis for the deltas). */
  toolNames?: string[];
  /**
   * Project this conversation belongs to — absent = "no project", a
   * legitimate case (discussing with no folder, an established invariant).
   *
   * The SCOPE (the roots) belongs to the project, not the conversation:
   * one single place to edit, one single place for permissions and
   * instructions. What the conversation owns is the EXECUTION — model,
   * sampling, play mode.
   */
  projectId?: string;
  /**
   * Scope in effect at the moment the system prompt was FROZEN. Compared
   * against the current scope to know whether a change of scenery needs
   * announcing — the ORDER matters, since it designates the default root.
   */
  frozenRoots?: string[];
  /**
   * Settings overrides for THIS conversation — sampling only (launch
   * parameters go into the KV manifest and remain global).
   */
  settings?: Record<string, unknown>;
  /**
   * Hash of the project instructions the system prompt was frozen with (or
   * last announced): a different one at open is announced by an appended
   * message. Absent with no instructions.
   */
  instructionsHash?: string;
  /** Kept at the top of the list. A mark, not activity. */
  pinned?: boolean;
  /** Out of the list until asked for. A mark, not activity. */
  archived?: boolean;
  /**
   * The conversation this one was branched (or duplicated) from — shown as
   * a mark, never sent to the model (D-44).
   */
  parentId?: string;
}

/** Options of a branch: where the log is cut, and the branch's title. */
export interface BranchOptions {
  /** Raw log events kept from the start; absent = all (a duplicate). */
  keepEvents?: number;
  title: string;
}

/**
 * Where a branch "from this turn" cuts the log: right after readable turn
 * `turn` (as `readableEvents` counts them — a user message, or an assistant
 * turn with its tool rounds), that is before the next one starts.
 */
export function cutAfterTurn(events: ConversationEvent[], turn: number): number {
  let readable = -1;
  let inAssistantTurn = false;
  for (let i = 0; i < events.length; i++) {
    const event = events[i] as ConversationEvent;
    if (event.type === 'rebase') {
      // A compaction is a readable turn of its own (the screen marks it).
      inAssistantTurn = false;
      readable += 1;
      if (readable === turn + 1) return i;
    } else if (event.type === 'user') {
      inAssistantTurn = false;
      if (event.text.trim() === '') continue;
      readable += 1;
      if (readable === turn + 1) return i;
    } else if (event.type === 'assistant' && event.entry && !inAssistantTurn) {
      inAssistantTurn = true;
      readable += 1;
      if (readable === turn + 1) return i;
    }
  }
  return events.length;
}

/** Readable turns in a log, as `readableEvents` counts them. */
export function countTurns(events: ConversationEvent[]): number {
  let readable = 0;
  let inAssistantTurn = false;
  for (const event of events) {
    if (event.type === 'rebase') {
      inAssistantTurn = false;
      readable += 1;
    } else if (event.type === 'user') {
      inAssistantTurn = false;
      if (event.text.trim() !== '') readable += 1;
    } else if (event.type === 'assistant' && event.entry && !inAssistantTurn) {
      inAssistantTurn = true;
      readable += 1;
    }
  }
  return readable;
}

export interface CreateConversationOptions {
  title?: string;
  modelPath?: string;
  nCtx?: number;
  projectId?: string;
}

/**
 * Persisted log. Assistant entries and tool results store the transcript
 * entry as-is (including the provider's verbatim text): that's what makes
 * it possible to replay a byte-identical render.
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
  /** Service message (inventory delta): in the prompt, not in the UI. */
  | { type: 'service'; text: string; at: string }
  /**
   * A compaction (P2.5, D-19): from here on, the prompt restarts from a
   * re-frozen system prompt, this summary, and the raw events from
   * `keepFrom` — the earlier turns stay in the log, for the screen.
   */
  | { type: 'rebase'; summary: string; keepFrom: number; at: string };

/** How a summary opens the prompt after a rebase. */
export function renderSummaryMessage(summary: string): string {
  return (
    '[conversation summary]\nThe earlier turns of this conversation were compacted to save context. ' +
    `What they established:\n${summary}`
  );
}

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
      // Empty = not named yet: the interface shows a localised placeholder,
      // the first message (or the user) gives the real title.
      title: options.title ?? '',
      createdAt: now,
      updatedAt: now,
      ...(options.modelPath ? { modelPath: options.modelPath } : {}),
      ...(options.nCtx !== undefined ? { nCtx: options.nCtx } : {}),
      ...(options.projectId ? { projectId: options.projectId } : {}),
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
      throw new Error(`Unknown conversation: ${id}`);
    }
  }

  /** Attaches the conversation to a project, or detaches it with `undefined`. */
  async setProjectId(id: string, projectId: string | undefined): Promise<void> {
    const meta = await this.meta(id);
    if (projectId === undefined) delete meta.projectId;
    else meta.projectId = projectId;
    meta.updatedAt = new Date().toISOString();
    await writeFile(this.metaPath(id), JSON.stringify(meta, null, 2), 'utf8');
  }

  /** Sets (or removes, with `undefined`) a settings override. */
  async setSetting(id: string, key: string, value: unknown): Promise<void> {
    const meta = await this.meta(id);
    const settings = { ...(meta.settings ?? {}) };
    if (value === undefined) delete settings[key];
    else settings[key] = value;
    meta.settings = settings;
    meta.updatedAt = new Date().toISOString();
    await writeFile(this.metaPath(id), JSON.stringify(meta, null, 2), 'utf8');
  }

  /**
   * Pins or archives. Marks, not activity: `updatedAt` does not move, so the
   * conversation keeps its place in time.
   */
  async setMarks(id: string, marks: { pinned?: boolean; archived?: boolean }): Promise<void> {
    const meta = await this.meta(id);
    for (const key of ['pinned', 'archived'] as const) {
      const value = marks[key];
      if (value === undefined) continue;
      if (value) meta[key] = true;
      else delete meta[key];
    }
    await writeFile(this.metaPath(id), JSON.stringify(meta, null, 2), 'utf8');
  }

  /**
   * A new conversation that starts as `sourceId` did: the same frozen system
   * prompt, inventory, scope, model and settings — byte for byte, so the
   * parent's saved state can serve as its prefix — and the log up to a point
   * (all of it: a duplicate). The parent is untouched.
   */
  async branch(sourceId: string, newId: string, options: BranchOptions): Promise<ConversationMeta> {
    const source = await this.meta(sourceId);
    const events = await this.loadEvents(sourceId);
    const kept = options.keepEvents === undefined ? events : events.slice(0, Math.max(0, options.keepEvents));
    const now = new Date().toISOString();
    const meta: ConversationMeta = {
      id: newId,
      title: options.title,
      createdAt: now,
      updatedAt: now,
      ...(source.modelPath !== undefined ? { modelPath: source.modelPath } : {}),
      ...(source.nCtx !== undefined ? { nCtx: source.nCtx } : {}),
      ...(source.backendState !== undefined ? { backendState: source.backendState } : {}),
      ...(source.toolNames !== undefined ? { toolNames: [...source.toolNames] } : {}),
      ...(source.projectId !== undefined ? { projectId: source.projectId } : {}),
      ...(source.frozenRoots !== undefined ? { frozenRoots: [...source.frozenRoots] } : {}),
      ...(source.settings !== undefined ? { settings: { ...source.settings } } : {}),
      parentId: sourceId,
    };
    await mkdir(this.convDir(newId), { recursive: true });
    await writeFile(this.metaPath(newId), JSON.stringify(meta, null, 2), 'utf8');
    await writeFile(this.logPath(newId), kept.map((event) => `${JSON.stringify(event)}\n`).join(''), 'utf8');
    return meta;
  }

  /** Renames the conversation (the rest of the meta is preserved). */
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

  /** Freezes the backend state and the tool inventory of the conversation. */
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

  /** Remembers the project in effect at freeze time (or after announcing the delta). */
  async setFrozenRoots(id: string, roots: string[]): Promise<void> {
    const meta = await this.meta(id);
    meta.frozenRoots = roots;
    await this.writeMeta(meta);
  }

  /**
   * A rebase re-freezes everything the system prompt was built from: the
   * frozen prompt, the inventory, the scope and the instructions go, and the
   * next open freezes them anew — the deltas folded in.
   */
  async resetFrozen(id: string): Promise<void> {
    const meta = await this.meta(id);
    delete meta.backendState;
    delete meta.toolNames;
    delete meta.frozenRoots;
    delete meta.instructionsHash;
    await this.writeMeta(meta);
  }

  /** Remembers the instructions in effect (frozen, or last announced); undefined when there are none. */
  async setInstructionsHash(id: string, hash: string | undefined): Promise<void> {
    const meta = await this.meta(id);
    if (hash === undefined) delete meta.instructionsHash;
    else meta.instructionsHash = hash;
    await this.writeMeta(meta);
  }

  /** Updates the reference inventory after announcing a delta. */
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
      throw new Error(`Unknown conversation: ${id}`);
    }
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ConversationEvent);
  }

  /**
   * Permanently deletes a conversation: log, meta, and manifest.
   * The KV state itself belongs to the KvStore — the caller forgets it separately.
   */
  async remove(id: string): Promise<void> {
    await rm(this.convDir(id), { recursive: true, force: true });
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
        // foreign folder or corrupted meta: ignored from the listing
      }
    }
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

/**
 * Rebuilds the semantic transcript from the persisted events. This is
 * what the loop and the backends consume — each backend then derives its
 * own representation from it.
 */
export function rebuildTranscript(
  events: ConversationEvent[],
): TranscriptEntry[] {
  const toEntry = (event: Exclude<ConversationEvent, { type: 'rebase' }>): TranscriptEntry => {
    if (event.type === 'assistant') return event.entry;
    if (event.type === 'tool_results') return event.entry;
    if (event.type === 'service') return { role: 'service', text: event.text };
    return { role: 'user', text: event.text };
  };
  // After a compaction the prompt restarts: the latest summary, the events
  // it kept, and what came after it. Earlier rebases are behind the cut.
  let last = -1;
  events.forEach((event, index) => {
    if (event.type === 'rebase') last = index;
  });
  if (last < 0) {
    return events.filter((e): e is Exclude<ConversationEvent, { type: 'rebase' }> => e.type !== 'rebase').map(toEntry);
  }
  const rebase = events[last] as Extract<ConversationEvent, { type: 'rebase' }>;
  const kept = [...events.slice(Math.min(rebase.keepFrom, last), last), ...events.slice(last + 1)].filter(
    (e): e is Exclude<ConversationEvent, { type: 'rebase' }> => e.type !== 'rebase',
  );
  return [{ role: 'service', text: renderSummaryMessage(rebase.summary) }, ...kept.map(toEntry)];
}
