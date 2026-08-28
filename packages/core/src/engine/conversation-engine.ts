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
import type { ConversationEvent, ConversationStore } from '../conversation/store.js';
import type { KvStore } from '../kv/kv-store.js';
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
  type: 'user' | 'assistant';
  text: string;
  at: string;
  segments?: ReadableSegment[];
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
 * Room kept for the reply when deciding whether a message fits. The loop
 * does not cap generation yet; when it does, this becomes that cap.
 */
const REPLY_ROOM = 1024;

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

  const flush = (): void => {
    if (turn && turn.segments.length > 0) {
      const text = turn.segments
        .filter((segment): segment is Extract<ReadableSegment, { kind: 'text' }> => segment.kind === 'text')
        .map((segment) => segment.text)
        .join('\n\n');
      out.push({ type: 'assistant', text, at: turn.at, segments: turn.segments });
    }
    turn = null;
  };

  for (const event of events) {
    if (event.type === 'user') {
      flush();
      if (event.text.trim() !== '') out.push({ type: 'user', text: event.text, at: event.at });
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
    const events = readableEvents(await store.loadEvents(conversationId));
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
    const { session, restore } = await ChatSession.open(
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
        live,
      },
      conversationId,
    );
    this.session = session;
    this.activeId = conversationId;
    // A restored state says how full the slot is; a fresh prefill says
    // nothing until its first turn ends.
    this.contextUsed = restore.restored ? restore.nRestored : 0;

    return {
      conversationId,
      modelPath: model,
      ...(live.nCtx > 0 ? { nCtx: live.nCtx } : {}),
      contextTokens: this.contextUsed,
      restore,
      events: readableEvents(await store.loadEvents(conversationId)),
    };
  }

  /**
   * Runs one turn. The conversation takes the slot first if it does not
   * hold it; every event is tagged with the conversation it belongs to, so
   * a host showing another conversation can route or ignore it. Resolves
   * when the turn is over — or at once with what is missing to run it.
   */
  async send(conversationId: string, text: string): Promise<NeedsModel | undefined> {
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
    const needed = this.contextUsed + estimateTokens(text) + REPLY_ROOM;
    if (nCtx > 0 && needed > nCtx) {
      this.emit({
        conversationId,
        event: { type: 'context_overflow', used: this.contextUsed, nCtx, needed },
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
      for await (const event of session.send(text, controller.signal)) {
        if (event.type === 'token') turn.text += event.text;
        else if (event.type === 'thinking') turn.thinking += event.text;
        else if (event.type === 'turn_end' && event.contextTokens > 0) {
          this.contextUsed = event.contextTokens;
        }
        this.emit({ conversationId, event });
      }
    } catch (error) {
      if (refusedAsTooLong(error)) {
        this.emit({
          conversationId,
          event: { type: 'context_overflow', used: this.contextUsed, nCtx, needed },
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

  private async release(): Promise<void> {
    await this.saveState();
    this.session = null;
    this.activeId = null;
  }

  private async settle(): Promise<void> {
    while (this.turn) await this.turn.done;
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
