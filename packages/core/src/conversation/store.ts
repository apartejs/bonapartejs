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
  return events.map((event): TranscriptEntry => {
    if (event.type === 'assistant') return event.entry;
    if (event.type === 'tool_results') return event.entry;
    if (event.type === 'service') return { role: 'service', text: event.text };
    return { role: 'user', text: event.text };
  });
}
