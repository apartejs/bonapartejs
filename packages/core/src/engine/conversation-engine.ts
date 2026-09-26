/**
 * ConversationEngine — owns the OPEN conversation (D-24, D-30): which one is
 * active on the single slot, its session, the turn in flight and what it
 * has produced so far, and the state to save before anything else takes
 * the slot. Hosts (the Electron harness today, a CLI tomorrow) wire events
 * in and out; they hold no conversation logic of their own.
 *
 * Two rules everything here follows:
 *
 * - Browsing is read-only. `history()` reads the log on disk and never
 *   touches the slot: a reply streaming in conversation A keeps streaming
 *   while the user reads B, completes, and is persisted. That is the
 *   criterion "a generation survives navigation".
 * - The slot changes hands only between turns. `open()` and `saveState()`
 *   wait for the turn in flight; a state is never saved mid-generation.
 */

import { existsSync } from 'node:fs';
import type { AgentEvent, ApprovalResolver } from '../agent/loop.js';
import { LlamaCppHttpError } from '../backend/llamacpp/http-client.js';
import type { SamplingParams } from '../backend/types.js';
import {
  countTurns,
  cutAfterTurn,
  renderUserMessage,
  type ConversationEvent,
  type ConversationStore,
  type MessageAttachment,
} from '../conversation/store.js';
import type { KvStore } from '../kv/kv-store.js';
import type { CheckpointStore, UndoResult } from '../checkpoints/store.js';
import type { PermissionEngine } from '../permissions/engine.js';
import { ChatSession, type OpenResult } from '../session/chat-session.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { EngineSupervisor } from './supervisor.js';

/** What a session needs from the host beyond the stores: the user's choices for this conversation. */
export interface SessionContext {
  replyLanguage?: string;
  sampling?: SamplingParams;
  thinking?: boolean;
  projectInstructions?: string;
  /**
   * Tokens this conversation may occupy, when it caps itself below the
   * server's context — a live setting, resolved by the host; absent or 0
   * means "the server's size". Never above it: the server stays the ceiling.
   */
  contextLimit?: number;
}

export interface ConversationEngineOptions {
  store: ConversationStore;
  kv: KvStore;
  registry: ToolRegistry;
  permissions: PermissionEngine;
  supervisor: EngineSupervisor;
  /** Is the model file still there? Injected for tests; `existsSync` otherwise. */
  modelExists?: (modelPath: string) => boolean;
  /** Model of the Settings, for a conversation that pins none. */
  defaultModel?: () => Promise<string | undefined>;
  /** Project roots of a conversation, ordered. Empty = no confinement. */
  rootsOf?: (conversationId: string) => Promise<string[]>;
  context?: (conversationId: string) => Promise<SessionContext>;
  approve?: ApprovalResolver;
  logger?: (line: string) => void;
  /** Where a turn's file changes are kept, to be undone (06 §1 D). */
  checkpoints?: CheckpointStore;
}

/** One piece of an assistant turn, as it was seen live: reasoning, text, a tool call with its outcome. */
export type ReadableSegment =
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; args: Record<string, unknown>; ok?: boolean; content?: string };

/**
 * A log event the UI can show. An assistant event is a whole TURN — every
 * round of the loop until the next user message — with its segments in
 * order, so that a conversation reads back the way it was seen: reasoning,
 * tool calls and their outcome, text. `text` is the visible text alone.
 */
export interface ReadableEvent {
  /** `compaction`: the turns before it were summarised for the model — `text` is the summary. */
  type: 'user' | 'assistant' | 'compaction';
  text: string;
  at: string;
  segments?: ReadableSegment[];
  /** Files joined to a user message, by name (their content is the model's, not the screen's). */
  attachments?: string[];
  /** The turn an assistant event answers — the key of its checkpoint. */
  turnId?: string;
  /** What that turn wrote, and whether it was undone. */
  changes?: { turnId: string; files: string[]; undone: boolean };
}

export interface NeedsModel {
  needsModel: true;
  conversationId: string;
  /** Pinned model whose file is no longer on disk. */
  missingModel?: string;
}

export interface Opened {
  conversationId: string;
  modelPath: string;
  /** What the server holds — denominator of the context gauge. Absent when unknown (remote). */
  nCtx?: number;
  /** Tokens already in the slot after the restore — the gauge's numerator at open. */
  contextTokens: number;
  restore: OpenResult['restore'];
  /** What the shared prefix did when nothing of the conversation's own was restored. */
  seed?: OpenResult['seed'];
  events: ReadableEvent[];
}

export type OpenOutcome = Opened | NeedsModel;

export interface History {
  conversationId: string;
  modelPath?: string;
  /** Managed engine, pinned model gone from disk: announced before anything is typed. */
  missingModel?: string;
  events: ReadableEvent[];
}

export interface TaggedEvent {
  conversationId: string;
  event: AgentEvent;
}

/** The turn in flight, as far as it got: what a screen coming back can catch up on. */
export interface InFlight {
  conversationId: string;
  text: string;
  thinking: string;
}

interface Turn extends InFlight {
  controller: AbortController;
  done: Promise<void>;
}

const MAX_TITLE = 60;

/**
 * What a compaction asks the model — in English, like everything sent to
 * it. The summary replaces the earlier turns in the prompt, so it has to
 * carry what the work needs to go on.
 */
export const SUMMARY_QUESTION =
  'Summarize this conversation so far, for your own use: it will replace the earlier turns in your context. ' +
  'Keep what the work needs to continue — the user’s goal and constraints, the decisions taken and why, ' +
  'the files and code involved (paths, names), what was done and verified, what failed, what remains to do. ' +
  'Be factual and complete; no preamble, no advice to the user.';

/** Room for the summary itself. */
const SUMMARY_MAX_TOKENS = 1536;

export interface CompactionResult {
  summary: string;
  /** Readable turns folded into the summary. */
  compactedTurns: number;
  /** Readable turns kept verbatim after it. */
  keptTurns: number;
}

/**
 * Room kept for the reply when deciding whether a message fits. The loop
 * does not cap generation yet; when it does, this becomes that cap.
 */
const REPLY_ROOM = 1024;

/** The room a conversation may take: its own cap when it has one, never above the server's. */
function effectiveLimit(nCtx: number, cap: number | undefined): number {
  const own = cap !== undefined && cap > 0 ? cap : 0;
  if (nCtx > 0 && own > 0) return Math.min(nCtx, own);
  return nCtx > 0 ? nCtx : own;
}

/** Rough token count of a message: the exact one is the server's, after the fact. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3) + 8;
}

/** llama-server's refusal of a prompt longer than its context (context shift off). */
function refusedAsTooLong(error: unknown): boolean {
  return (
    error instanceof LlamaCppHttpError && error.status === 400 && /context size/i.test(error.message)
  );
}

export function stripThink(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
}

export function readableEvents(events: ConversationEvent[]): ReadableEvent[] {
  const out: ReadableEvent[] = [];
  let turn: { at: string; segments: ReadableSegment[] } | null = null;
  let turnId: string | undefined;

  const flush = (): void => {
    if (turn && turn.segments.length > 0) {
      const text = turn.segments
        .filter((segment): segment is Extract<ReadableSegment, { kind: 'text' }> => segment.kind === 'text')
        .map((segment) => segment.text)
        .join('\n\n');
      out.push({ type: 'assistant', text, at: turn.at, segments: turn.segments, ...(turnId ? { turnId } : {}) });
    }
    turn = null;
  };

  for (const event of events) {
    if (event.type === 'rebase') {
      flush();
      out.push({ type: 'compaction', text: event.summary, at: event.at });
      continue;
    }
    if (event.type === 'user') {
      flush();
      turnId = event.turnId;
      const files = event.attachments?.map((file) => file.name) ?? [];
      if (event.text.trim() !== '' || files.length > 0) {
        out.push({ type: 'user', text: event.text, at: event.at, ...(files.length > 0 ? { attachments: files } : {}) });
      }
      continue;
    }
    // A corrupted log line is skipped: it does not take the conversation down.
    if (event.type === 'assistant' && event.entry) {
      turn ??= { at: event.at, segments: [] };
      const thinking = event.entry.thinking?.trim();
      if (thinking) turn.segments.push({ kind: 'thinking', text: thinking });
      const text = stripThink(event.entry.text).trim();
      if (text) turn.segments.push({ kind: 'text', text });
      for (const call of event.entry.calls ?? []) {
        turn.segments.push({ kind: 'tool', name: call.name, args: call.arguments });
      }
      continue;
    }
    if (event.type === 'tool_results' && event.entry && turn) {
      // Results come back in call order; for equal names, the oldest one
      // still without an outcome is the right one.
      for (const result of event.entry.results) {
        const pending = turn.segments.find(
          (segment): segment is Extract<ReadableSegment, { kind: 'tool' }> =>
            segment.kind === 'tool' && segment.name === result.name && segment.ok === undefined,
        );
        if (pending) {
          pending.ok = result.ok;
          pending.content = result.content;
        }
      }
    }
  }
  flush();
  return out;
}

export class ConversationEngine {
  private session: ChatSession | null = null;
  private activeId: string | null = null;
  private turn: Turn | null = null;
  /** Tokens the slot holds for the active conversation — prompt and replies so far. */
  private contextUsed = 0;
  /** Model of the active session. */
  private activeModel: string | null = null;
  /** Prefill speed measured per model on this machine, tokens per second (a running average). */
  private readonly prefillRates = new Map<string, number>();
  private readonly listeners = new Set<(event: TaggedEvent) => void>();
  private readonly modelExists: (modelPath: string) => boolean;

  constructor(private readonly options: ConversationEngineOptions) {
    this.modelExists = options.modelExists ?? existsSync;
  }

  /** The conversation holding the slot, if any. */
  get active(): string | null {
    return this.activeId;
  }

  onEvent(listener: (event: TaggedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Tokens per second this machine prefills with this model, once measured. */
  prefillRate(modelPath: string): number | undefined {
    return this.prefillRates.get(modelPath);
  }

  /** Tokens the slot holds for this conversation, when it is the open one. */
  contextTokensOf(conversationId: string): number | undefined {
    return this.activeId === conversationId && this.session ? this.contextUsed : undefined;
  }

  inFlight(): InFlight | null {
    if (!this.turn) return null;
    const { conversationId, text, thinking } = this.turn;
    return { conversationId, text, thinking };
  }

  /**
   * Read-only: the history comes from the log on disk, never from the
   * slot. Nothing is loaded, nothing is saved, and a turn in flight
   * elsewhere keeps going.
   */
  async history(conversationId: string): Promise<History> {
    const { store, supervisor } = this.options;
    if (!(await store.exists(conversationId))) {
      return { conversationId, events: [] };
    }
    const meta = await store.meta(conversationId);
    const events = await this.withChanges(conversationId, readableEvents(await store.loadEvents(conversationId)));
    const missing =
      meta.modelPath !== undefined &&
      supervisor.engine?.mode === 'managed' &&
      !this.modelExists(meta.modelPath);
    return {
      conversationId,
      ...(meta.modelPath !== undefined ? { modelPath: meta.modelPath } : {}),
      ...(missing && meta.modelPath !== undefined ? { missingModel: meta.modelPath } : {}),
      events,
    };
  }

  /**
   * Takes the slot for this conversation: the turn in flight ends first,
   * the conversation leaving saves its state, the engine serves the model
   * (pinned; an explicit `modelPath` replaces the pin — the user chose it),
   * the session opens and its state is restored when the manifest matches.
   */
  async open(conversationId: string, modelPath?: string): Promise<OpenOutcome> {
    const { store, supervisor } = this.options;
    const engine = supervisor.engine;
    if (!engine) throw new Error('Engine not configured.');

    await this.settle();
    if (this.activeId !== null && this.activeId !== conversationId) {
      await this.release();
    }

    const meta = (await store.exists(conversationId)) ? await store.meta(conversationId) : undefined;
    let model = modelPath ?? meta?.modelPath ?? (await this.options.defaultModel?.());

    if (engine.mode === 'managed') {
      if (!model) return { needsModel: true, conversationId };
      // Announced before any launch: the engine would only fail later, with
      // an error about a file the user deleted weeks ago. Nothing is pinned
      // either — the pick that follows is the one that gets recorded.
      if (!this.modelExists(model)) return { needsModel: true, conversationId, missingModel: model };
      if (meta && meta.modelPath !== model) await store.setModel(conversationId, model);
      // Another model on the slot: the session bound to the previous server
      // saves its state while that server is still alive.
      if (this.session && supervisor.loaded && supervisor.loaded.modelPath !== model) {
        await this.release();
      }
      await supervisor.ensureLoaded(model);
    } else {
      if (!supervisor.backend) await supervisor.connect();
      // Remote: the model is whatever the server has — informational only.
      if (!model) model = supervisor.loaded?.modelPath ?? 'remote';
      if (meta && meta.modelPath !== model) await store.setModel(conversationId, model);
    }

    const backend = supervisor.backend;
    const live = supervisor.live;
    if (!backend || !live) throw new Error('Backend not started.');

    if (!meta) await store.create(conversationId, { modelPath: model });

    const context = (await this.options.context?.(conversationId)) ?? {};
    const roots = (await this.options.rootsOf?.(conversationId)) ?? [];
    const { session, restore, seed } = await ChatSession.open(
      {
        backend,
        kv: this.options.kv,
        store,
        registry: this.options.registry,
        permissions: this.options.permissions,
        ...(roots.length > 0 ? { roots } : {}),
        ...(this.options.approve ? { approve: this.options.approve } : {}),
        ...(context.replyLanguage ? { replyLanguage: context.replyLanguage } : {}),
        ...(context.projectInstructions
          ? { projectInstructions: context.projectInstructions }
          : {}),
        ...(context.sampling ? { sampling: context.sampling } : {}),
        ...(context.thinking !== undefined ? { thinking: context.thinking } : {}),
        ...(this.options.checkpoints ? { checkpoints: this.options.checkpoints } : {}),
        live,
      },
      conversationId,
    );
    this.session = session;
    this.activeId = conversationId;
    this.activeModel = model;
    // A restored state says how full the slot is; so does a seed, restored
    // or just prepared; a fresh prefill says nothing until its first turn.
    this.contextUsed = restore.restored
      ? restore.nRestored
      : seed?.restored
        ? seed.nRestored
        : seed?.created
          ? seed.nTokens
          : 0;

    return {
      conversationId,
      modelPath: model,
      ...(live.nCtx > 0 ? { nCtx: live.nCtx } : {}),
      contextTokens: this.contextUsed,
      restore,
      ...(seed ? { seed } : {}),
      events: readableEvents(await store.loadEvents(conversationId)),
    };
  }

  /**
   * Runs one turn. The conversation takes the slot first if it does not
   * hold it; every event is tagged with the conversation it belongs to, so
   * a host showing another conversation can route or ignore it. Resolves
   * when the turn is over — or at once with what is missing to run it.
   */
  async send(
    conversationId: string,
    text: string,
    attachments?: MessageAttachment[],
  ): Promise<NeedsModel | undefined> {
    if (this.activeId !== conversationId || !this.session) {
      const outcome = await this.open(conversationId);
      if ('needsModel' in outcome) return outcome;
    }
    await this.settle();
    const session = this.session;
    if (!session) throw new Error('No conversation open.');

    // The context is finite, and the server never shifts it for us (D-22):
    // a message that cannot fit — with room for a reply — is refused HERE,
    // before anything is persisted or sent. The estimate is rough (a fresh
    // prefill's system prompt is not counted until its first turn); the
    // server's own refusal, below, is the safety net.
    const nCtx = this.options.supervisor.live?.nCtx ?? 0;
    const limit = effectiveLimit(nCtx, (await this.options.context?.(conversationId))?.contextLimit);
    const needed = this.contextUsed + estimateTokens(renderUserMessage(text, attachments)) + REPLY_ROOM;
    if (limit > 0 && needed > limit) {
      this.emit({
        conversationId,
        event: { type: 'context_overflow', used: this.contextUsed, nCtx, limit, needed },
      });
      return undefined;
    }

    await this.titleFromFirstMessage(conversationId, text);

    const controller = new AbortController();
    let finish: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const turn: Turn = { conversationId, text: '', thinking: '', controller, done };
    this.turn = turn;
    try {
      for await (const event of session.send(text, controller.signal, attachments)) {
        if (event.type === 'token') turn.text += event.text;
        else if (event.type === 'thinking') turn.thinking += event.text;
        else if (event.type === 'turn_end') {
          if (event.contextTokens > 0) this.contextUsed = event.contextTokens;
          this.measurePrefill(event.promptTokens - event.cachedTokens, event.promptMs);
        }
        this.emit({ conversationId, event });
      }
    } catch (error) {
      if (refusedAsTooLong(error)) {
        this.emit({
          conversationId,
          event: { type: 'context_overflow', used: this.contextUsed, nCtx, limit, needed },
        });
      } else {
        this.emit({
          conversationId,
          event: { type: 'error', message: error instanceof Error ? error.message : String(error) },
        });
      }
    } finally {
      if (this.turn === turn) this.turn = null;
      finish();
    }
    return undefined;
  }

  /** Stops the turn in flight of this conversation; what arrived stays. */
  cancel(conversationId: string): void {
    if (this.turn?.conversationId === conversationId) this.turn.controller.abort();
  }

  /** Saves the active conversation's KV state — between turns, never during one. */
  async saveState(): Promise<boolean> {
    await this.settle();
    if (!this.session) return false;
    try {
      return await this.session.save();
    } catch (error) {
      this.options.logger?.(`[kv] save failed: ${String(error)}`);
      return false;
    }
  }

  /**
   * Cuts the turn in flight, saves, and lets go of the slot; the engine keeps
   * running for the next open. Cutting, not waiting: a host shutting down —
   * or a settings change — must not hang on a reply, nor on a tool call
   * waiting for consent nobody will give.
   */
  async close(): Promise<void> {
    this.turn?.controller.abort();
    await this.settle();
    await this.release();
  }

  /**
   * A new conversation that starts as `sourceId` did (D-44): the same frozen
   * prompt, the log up to readable turn `afterTurn` (all of it: a
   * duplicate), and the parent's saved state — so its first turn reads the
   * shared prefix from the cache instead of computing it again. The parent,
   * if open, saves first, so the copy is its latest. Between turns only.
   */
  async branch(
    sourceId: string,
    newId: string,
    options: { title: string; afterTurn?: number },
  ): Promise<{ inheritedState: boolean }> {
    await this.settle();
    if (this.activeId === sourceId) await this.saveState();
    const { store, kv } = this.options;
    const keepEvents =
      options.afterTurn === undefined ? undefined : cutAfterTurn(await store.loadEvents(sourceId), options.afterTurn);
    await store.branch(sourceId, newId, {
      title: options.title,
      ...(keepEvents !== undefined ? { keepEvents } : {}),
    });
    return { inheritedState: await kv.copyState(sourceId, newId) };
  }

  /**
   * Compaction IS the rebase (P2.5, D-19) — an explicit event, never a side
   * effect. The model summarises the conversation beside it (the context is
   * in the slot: served from the cache); a `rebase` event lands in the log;
   * the frozen system prompt, inventory, scope and instructions are reset —
   * the next open freezes them anew with the deltas folded in — and the
   * saved state, built on the old prompt, is forgotten. The prompt then
   * restarts from the summary and the last `keepTurns` readable turns; the
   * screen keeps every turn. Between turns only.
   */
  async compact(conversationId: string, options: { keepTurns?: number } = {}): Promise<CompactionResult> {
    await this.settle();
    if (this.activeId !== conversationId || !this.session) {
      const outcome = await this.open(conversationId);
      if ('needsModel' in outcome) throw new Error('No model to summarise this conversation with.');
    }
    const session = this.session;
    if (!session) throw new Error('No conversation open.');
    const summary = await session.summarize(SUMMARY_QUESTION, SUMMARY_MAX_TOKENS);
    if (!summary) throw new Error('The engine cannot summarise a conversation.');

    const { store, kv, supervisor } = this.options;
    const events = await store.loadEvents(conversationId);
    const total = countTurns(events);
    const keep = Math.max(0, Math.min(options.keepTurns ?? 2, total));
    const keepFrom = keep === 0 ? events.length : keep >= total ? 0 : cutAfterTurn(events, total - keep - 1);
    await store.appendEvent(conversationId, {
      type: 'rebase',
      summary,
      keepFrom,
      at: new Date().toISOString(),
    });
    await store.resetFrozen(conversationId);
    supervisor.backend?.forgetConversation?.(conversationId);
    await kv.forget(conversationId);
    // The slot holds the old prompt: let go of it without saving.
    this.session = null;
    this.activeId = null;
    this.activeModel = null;
    this.contextUsed = 0;
    return { summary, compactedTurns: total - keep, keptTurns: keep };
  }

  /** Each assistant turn that wrote files says which, and whether they were undone. */
  private async withChanges(conversationId: string, events: ReadableEvent[]): Promise<ReadableEvent[]> {
    const checkpoints = this.options.checkpoints;
    if (!checkpoints) return events;
    return Promise.all(
      events.map(async (event) => {
        if (event.type !== 'assistant' || !event.turnId) return event;
        const changes = await checkpoints.changes(conversationId, event.turnId);
        return changes ? { ...event, changes: { turnId: event.turnId, ...changes } } : event;
      }),
    );
  }

  /**
   * Undoes a turn's file changes (06 §1 D): the originals go back — except
   * a file changed again since, left alone — and the model is told, or it
   * would go on believing its edits are there. Between turns.
   */
  async undoTurn(conversationId: string, turnId: string): Promise<UndoResult> {
    const checkpoints = this.options.checkpoints;
    if (!checkpoints) return { restored: [], conflicts: [] };
    await this.settle();
    const result = await checkpoints.undo(conversationId, turnId);
    if (result.restored.length === 0) return result;
    const text =
      '[user action]\nThe user undid the file changes of an earlier turn: ' +
      `${result.restored.join(', ')} ${result.restored.length === 1 ? 'is' : 'are'} back to their state before it.` +
      (result.conflicts.length > 0
        ? ` Left as they are, because they changed since: ${result.conflicts.join(', ')}.`
        : '');
    if (this.activeId === conversationId && this.session) await this.session.note(text);
    else await this.options.store.appendEvent(conversationId, { type: 'service', text, at: new Date().toISOString() });
    return result;
  }

  /**
   * Erases a conversation for good: its log, its meta, its saved state. A
   * turn in flight there is cut and allowed to finish writing FIRST, so
   * nothing lands after the erase; the open conversation lets go of the
   * slot without saving — writing the state of what is being deleted would
   * leave exactly what the user asked to remove.
   */
  async remove(conversationId: string): Promise<void> {
    if (this.turn?.conversationId === conversationId) {
      this.turn.controller.abort();
      await this.settle();
    }
    if (this.activeId === conversationId) {
      this.session = null;
      this.activeId = null;
      this.activeModel = null;
      this.contextUsed = 0;
    }
    await this.options.store.remove(conversationId);
    await this.options.kv.forget(conversationId);
    await this.options.checkpoints?.forget(conversationId);
  }

  private async release(): Promise<void> {
    await this.saveState();
    this.session = null;
    this.activeId = null;
  }

  private async settle(): Promise<void> {
    while (this.turn) await this.turn.done;
  }

  /**
   * A turn that prefilled enough to be meaningful teaches the speed of its
   * model on this machine — what a switch back to it will be announced at.
   */
  private measurePrefill(uncached: number, ms: number): void {
    if (!this.activeModel || uncached < 64 || !(ms > 0)) return;
    const rate = uncached / (ms / 1000);
    const previous = this.prefillRates.get(this.activeModel);
    this.prefillRates.set(this.activeModel, previous === undefined ? rate : previous * 0.5 + rate * 0.5);
  }

  private emit(event: TaggedEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /**
   * The first message names the conversation, and it alone: renaming later
   * would overwrite a title the user may have chosen.
   */
  private async titleFromFirstMessage(conversationId: string, text: string): Promise<void> {
    try {
      const events = await this.options.store.loadEvents(conversationId);
      if (events.some((event) => event.type === 'user')) return;
      const line = text.trim().replace(/\s+/g, ' ');
      if (!line) return;
      await this.options.store.setTitle(
        conversationId,
        line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 3)}…` : line,
      );
    } catch {
      /* a title is a convenience: never something that should fail a send */
    }
  }
}
