/**
 * Conversation persistence — append-only JSONL log + meta, one folder per
 * conversation. The log records EVERYTHING needed to reconstruct a
 * byte-identical PromptLog (including the thinking flag of each turn).
 */

import { assertConversationId } from './ids.js';
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { KeyedQueue, readJsonFile, writeJsonFile } from '../fs/json-file.js';
import { join } from 'node:path';
import type { TranscriptEntry } from '../backend/types.js';
import { neutralizeControlTokens } from '../wire/control-tokens.js';

/** A text file joined to a user message: kept apart in the log, rendered for the model. */
export interface MessageAttachment {
  name: string;
  content: string;
}

/**
 * What the model reads for a user message: the text, then each joined file
 * in a fenced block — its content neutralised like a tool result (a file
 * is not the user speaking). Deterministic: the log replays it byte for byte.
 */
export function renderUserMessage(text: string, attachments?: MessageAttachment[]): string {
  if (!attachments || attachments.length === 0) return text;
  const files = attachments.map(
    (file) => `[attached file: ${file.name}]\n\`\`\`\n${neutralizeControlTokens(file.content)}\n\`\`\``,
  );
  return [text, ...files].join('\n\n');
}

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
  | {
      type: 'user';
      text: string;
      at: string;
      attachments?: MessageAttachment[];
      /** The turn this message opened — the key of its checkpoint. */
      turnId?: string;
    }
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
    return join(this.dir, assertConversationId(id));
  }

  /** One change of a meta at a time, per conversation. */
  private readonly metaQueue = new KeyedQueue();

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
    await this.writeMetaFile(meta);
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
    await this.updateMeta(id, (meta) => {
      if (projectId === undefined) delete meta.projectId;
      else meta.projectId = projectId;
    });
  }

  /** Sets (or removes, with `undefined`) a settings override. */
  async setSetting(id: string, key: string, value: unknown): Promise<void> {
    await this.updateMeta(id, (meta) => {
      const settings = { ...(meta.settings ?? {}) };
      if (value === undefined) delete settings[key];
      else settings[key] = value;
      meta.settings = settings;
    });
  }

  /**
   * Pins or archives. Marks, not activity: `updatedAt` does not move, so the
   * conversation keeps its place in time.
   */
  async setMarks(id: string, marks: { pinned?: boolean; archived?: boolean }): Promise<void> {
    await this.updateMeta(
      id,
      (meta) => {
        for (const key of ['pinned', 'archived'] as const) {
          const value = marks[key];
          if (value === undefined) continue;
          if (value) meta[key] = true;
          else delete meta[key];
        }
      },
      { touch: false },
    );
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
    await this.writeMetaFile(meta);
    await writeFile(this.logPath(newId), kept.map((event) => `${JSON.stringify(event)}\n`).join(''), 'utf8');
    return meta;
  }

  /** Renames the conversation (the rest of the meta is preserved). */
  async setTitle(id: string, title: string): Promise<void> {
    await this.updateMeta(id, (meta) => {
      meta.title = title;
    });
  }

  async setModel(id: string, modelPath: string, nCtx?: number): Promise<void> {
    await this.updateMeta(id, (meta) => {
      meta.modelPath = modelPath;
      if (nCtx !== undefined) meta.nCtx = nCtx;
    });
  }

  /** Freezes the backend state and the tool inventory of the conversation. */
  async freezeBackendState(
    id: string,
    backendState: unknown,
    toolNames: string[],
  ): Promise<void> {
    await this.updateMeta(id, (meta) => {
      meta.backendState = backendState;
      meta.toolNames = [...toolNames];
    });
  }

  /** Remembers the project in effect at freeze time (or after announcing the delta). */
  async setFrozenRoots(id: string, roots: string[]): Promise<void> {
    await this.updateMeta(id, (meta) => {
      meta.frozenRoots = roots;
    });
  }

  /**
   * A rebase re-freezes everything the system prompt was built from: the
   * frozen prompt, the inventory, the scope and the instructions go, and the
   * next open freezes them anew — the deltas folded in.
   */
  async resetFrozen(id: string): Promise<void> {
    await this.updateMeta(id, (meta) => {
      delete meta.backendState;
      delete meta.toolNames;
      delete meta.frozenRoots;
      delete meta.instructionsHash;
    });
  }

  /** Remembers the instructions in effect (frozen, or last announced); undefined when there are none. */
  async setInstructionsHash(id: string, hash: string | undefined): Promise<void> {
    await this.updateMeta(id, (meta) => {
      if (hash === undefined) delete meta.instructionsHash;
      else meta.instructionsHash = hash;
    });
  }

  /** Updates the reference inventory after announcing a delta. */
  async setFrozenTools(id: string, toolNames: string[]): Promise<void> {
    await this.updateMeta(id, (meta) => {
      meta.toolNames = [...toolNames];
    });
  }

  /**
   * Every change of a meta goes through here: a turn, the sidebar and a
   * click can touch one conversation at once. Per conversation, one change
   * at a time — a read-modify-write never loses another's — and the file is
   * replaced whole, so a reader never sees it half written (a listing used
   * to drop the conversation, and a turn to fail on "Unexpected end of JSON
   * input", while its meta was being rewritten).
   */
  private async updateMeta(
    id: string,
    mutate: (meta: ConversationMeta) => void,
    options: { touch?: boolean } = {},
  ): Promise<void> {
    await this.metaQueue.run(id, async () => {
      const meta = await this.meta(id);
      mutate(meta);
      if (options.touch !== false) meta.updatedAt = new Date().toISOString();
      await this.writeMetaFile(meta);
    });
  }

  private async writeMetaFile(meta: ConversationMeta): Promise<void> {
    await writeJsonFile(this.metaPath(meta.id), meta);
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
    return (await readJsonFile(this.metaPath(id))) as ConversationMeta;
  }

  async appendEvent(id: string, event: ConversationEvent): Promise<void> {
    await appendFile(this.logPath(id), `${JSON.stringify(event)}\n`, 'utf8');
    await this.updateMeta(id, () => undefined);
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
    return { role: 'user', text: renderUserMessage(event.text, event.attachments) };
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
