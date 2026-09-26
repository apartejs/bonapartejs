/**
 * ChatSession — orchestrates ONE active conversation: semantic transcript,
 * agentic loop (tools + permissions), event persistence, and KV state
 * save/restore via the strict manifest.
 *
 * It knows NO provider detail whatsoever: it passes a transcript and a
 * `SystemSpec` to the backend, which derives its own representation from it.
 */

import { AgentLoop, type AgentEvent, type ApprovalResolver } from '../agent/loop.js';
import type { Backend, SamplingParams, TranscriptEntry } from '../backend/types.js';
import {
  rebuildTranscript,
  type ConversationStore,
} from '../conversation/store.js';
import type {
  KvStore,
  LiveBackendConfig,
  RestoreOutcome,
  SeedOutcome,
} from '../kv/kv-store.js';
import type { PermissionEngine } from '../permissions/engine.js';
import type { ToolRegistry } from '../tools/registry.js';
import { createHash } from 'node:crypto';
import { renderInstructionsDelta, renderInventoryDelta, renderPerimeterDelta } from '../wire/system-prompt.js';

function instructionsHash(text: string | undefined): string | undefined {
  return text ? createHash('sha256').update(text).digest('hex').slice(0, 32) : undefined;
}

export interface ChatSessionOptions {
  backend: Backend;
  kv: KvStore;
  store: ConversationStore;
  registry: ToolRegistry;
  permissions: PermissionEngine;
  /**
   * Project roots, ORDERED. Empty = project-less conversation: the tools
   * still work, simply without confinement.
   */
  roots?: string[];
  live: LiveBackendConfig;
  /** Expected reply language (e.g. "French") — the wire stays English. */
  replyLanguage?: string;
  projectInstructions?: string;
  approve?: ApprovalResolver;
  maxTurns?: number;
  idSlot?: number;
  /** Conversation sampling, adjustable without invalidating the cache. */
  sampling?: SamplingParams;
  /** Whether the model may reason before answering. Default: on. */
  thinking?: boolean;
}

export type OpenResult = {
  session: ChatSession;
  /** 'unsupported': the backend does not have the kvPersistence capability. */
  restore: RestoreOutcome | { restored: false; reason: 'unsupported' };
  /** When nothing of the conversation's own was restored: what the shared prefix did. */
  seed?: SeedOutcome;
};

/**
 * The shared prefix. Every conversation of a (model, tools, project) begins
 * with the same rendered system block, and a restored state serves as the
 * prefix of a longer, different prompt (proved for real on 2026-08-28). So
 * the first one prefills that block once and saves it as a seed; the next
 * ones restore the seed and only prefill what is theirs. A failure here
 * costs nothing but the seed: the turn prefills as it always did.
 */
async function seedPrefix(
  backend: Backend,
  kv: KvStore,
  idSlot: number,
  conversationId: string,
  live: LiveBackendConfig,
): Promise<SeedOutcome | undefined> {
  if (!backend.slots || !backend.prefixText || !backend.prefill) return undefined;
  const prefix = backend.prefixText(conversationId);
  if (!prefix) return undefined;
  const key = kv.seedKey(prefix, live);
  const found = await kv.restoreSeed(backend.slots, idSlot, key, live);
  if (found.restored) return found;
  try {
    const nTokens = await backend.prefill(conversationId, idSlot);
    if (nTokens <= 0) return found;
    await kv.saveSeed(backend.slots, idSlot, key, live, nTokens);
    return { restored: false, created: true, nTokens };
  } catch {
    return found;
  }
}

export class ChatSession {
  private constructor(
    private readonly options: ChatSessionOptions,
    private readonly conversationId: string,
    private readonly transcript: TranscriptEntry[],
    private readonly loop: AgentLoop,
  ) {}

  static async open(
    options: ChatSessionOptions,
    conversationId: string,
  ): Promise<OpenResult> {
    const { store, backend, kv, live, registry } = options;

    if (!(await store.exists(conversationId))) {
      await store.create(conversationId);
    }

    // The backend state (frozen prompt for llama.cpp) is handed back to
    // the backend as-is: rebuilding it would let it drift with the
    // inventory.
    const meta = await store.meta(conversationId);
    if (meta.backendState !== undefined) {
      backend.importState?.(conversationId, meta.backendState);
    }

    const transcript = rebuildTranscript(await store.loadEvents(conversationId));

    const loop = new AgentLoop({
      backend,
      registry,
      permissions: options.permissions,
      conversationId,
      system: {
        ...(options.roots && options.roots.length > 0 ? { roots: options.roots } : {}),
        ...(options.replyLanguage ? { replyLanguage: options.replyLanguage } : {}),
        ...(options.projectInstructions
          ? { projectInstructions: options.projectInstructions }
          : {}),
      },
      ...(options.approve ? { approve: options.approve } : {}),
      ...(options.sampling ? { sampling: options.sampling } : {}),
      ...(options.thinking !== undefined ? { thinking: options.thinking } : {}),
      ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
      ...(options.idSlot !== undefined ? { idSlot: options.idSlot } : {}),
    });

    // The backend freezes what it needs to freeze NOW (system prompt for
    // llama.cpp), not on the first turn.
    backend.prepareConversation?.(
      conversationId,
      {
        ...(options.roots && options.roots.length > 0 ? { roots: options.roots } : {}),
        ...(options.replyLanguage ? { replyLanguage: options.replyLanguage } : {}),
        ...(options.projectInstructions
          ? { projectInstructions: options.projectInstructions }
          : {}),
      },
      registry.list(),
    );

    const session = new ChatSession(options, conversationId, transcript, loop);

    // Has the tooling moved since the freeze? If so: an APPENDED service
    // message (never a re-render of the system prompt).
    await session.announceInventoryDelta(meta.toolNames);
    // Has the scenery changed since the freeze? Same rule: we append.
    if (meta.toolNames !== undefined) {
      await session.announcePerimeterDelta(meta.frozenRoots ?? []);
      // And the project's instructions: the frozen prompt holds the old
      // ones; the new ones are appended.
      await session.announceInstructionsDelta(meta.instructionsHash);
    }

    if (!backend.slots) {
      return { session, restore: { restored: false, reason: 'unsupported' } };
    }
    const restore = await kv.restoreState(
      backend.slots,
      options.idSlot ?? 0,
      conversationId,
      live,
    );
    if (restore.restored) return { session, restore };
    // Nothing of its own to restore: the conversation starts from the seed
    // of its prefix — or prepares it for the next one that starts this way.
    const seed = await seedPrefix(backend, kv, options.idSlot ?? 0, conversationId, live);
    return { session, restore, ...(seed ? { seed } : {}) };
  }

  get id(): string {
    return this.conversationId;
  }

  private async announceInventoryDelta(frozenNames?: string[]): Promise<void> {
    const { registry, store, backend } = this.options;
    const names = registry.list().map((d) => d.name);

    // First opening: nothing to announce, we just record the reference
    // inventory (and the state the backend will have frozen by the first
    // turn).
    if (frozenNames === undefined) {
      await store.freezeBackendState(
        this.conversationId,
        backend.exportState?.(this.conversationId),
        names,
      );
      // The scenery is frozen at the same time as the inventory: without
      // that, reopening would think a project had just appeared and would
      // announce a change that never happened.
      await store.setFrozenRoots(this.conversationId, this.options.roots ?? []);
      await store.setInstructionsHash(this.conversationId, instructionsHash(this.options.projectInstructions));
      return;
    }

    const message = renderInventoryDelta(
      registry.diff({ names: frozenNames, hash: '' }),
    );
    if (!message) return;

    await this.appendService(message);
    await store.setFrozenTools(this.conversationId, names);
  }

  /**
   * The system prompt is frozen at creation: if the perimeter has moved
   * since then — a folder added, removed, or simply REORDERED, which
   * changes the default root for relative paths — the model would be
   * working off stale scenery. We announce it with an APPENDED message,
   * never with a re-render.
   */
  private async announcePerimeterDelta(frozen: string[]): Promise<void> {
    const current = this.options.roots ?? [];
    const message = renderPerimeterDelta(frozen, current);
    if (!message) return;

    await this.appendService(message);
    await this.options.store.setFrozenRoots(this.conversationId, current);
  }

  private async announceInstructionsDelta(frozenHash: string | undefined): Promise<void> {
    const current = this.options.projectInstructions;
    const hash = instructionsHash(current);
    if (hash === frozenHash) return;
    await this.appendService(renderInstructionsDelta(current));
    await this.options.store.setInstructionsHash(this.conversationId, hash);
  }

  /** Service message: in the transcript AND in the log, never in the UI. */
  private async appendService(text: string): Promise<void> {
    this.transcript.push({ role: 'service', text });
    await this.options.store.appendEvent(this.conversationId, {
      type: 'service',
      text,
      at: new Date().toISOString(),
    });
  }

  /** Turns run one at a time: a send waits for the one in flight to finish. */
  private queue: Promise<void> = Promise.resolve();

  /**
   * Sends a message and runs the agentic loop. Every transcript mutation
   * announced by the loop is persisted in the same order: replaying
   * reconstructs an identical transcript.
   *
   * Sends are serialised. The composer lets the next message be typed and
   * sent while a reply streams (aparté 0.14.0); two turns at once on one
   * slot would interleave the prompts, the events and the log — the second
   * simply queues behind the first.
   */
  async *send(text: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const previous = this.queue;
    let release: () => void = () => undefined;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      yield* this.runTurn(text, signal);
    } finally {
      release();
    }
  }

  private async *runTurn(text: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const { store, backend } = this.options;
    const now = (): string => new Date().toISOString();

    await store.appendEvent(this.conversationId, {
      type: 'user',
      text,
      at: now(),
    });

    const effective = signal ?? new AbortController().signal;
    for await (const event of this.loop.run(this.transcript, text, effective)) {
      if (event.type === 'assistant_committed') {
        await store.appendEvent(this.conversationId, {
          type: 'assistant',
          entry: event.entry as Extract<TranscriptEntry, { role: 'assistant' }>,
          at: now(),
        });
      } else if (event.type === 'results_committed') {
        await store.appendEvent(this.conversationId, {
          type: 'tool_results',
          entry: event.entry as Extract<TranscriptEntry, { role: 'tool_results' }>,
          at: now(),
        });
      }
      yield event;
    }

    // The backend may have frozen its state on the first turn (system prompt).
    const state = backend.exportState?.(this.conversationId);
    if (state !== undefined) {
      await store.freezeBackendState(
        this.conversationId,
        state,
        this.options.registry.list().map((d) => d.name),
      );
    }
  }

  /**
   * The model's summary of the conversation so far, asked beside it: the
   * frozen history is in the slot (served from the cache), the question and
   * the answer never enter the log. Undefined when the backend cannot.
   */
  async summarize(question: string, maxTokens: number, signal?: AbortSignal): Promise<string | undefined> {
    const { backend, registry } = this.options;
    if (!backend.sideCompletion) return undefined;
    await this.queue;
    return backend.sideCompletion({
      conversationId: this.conversationId,
      transcript: this.transcript,
      system: {
        ...(this.options.roots && this.options.roots.length > 0 ? { roots: this.options.roots } : {}),
        ...(this.options.replyLanguage ? { replyLanguage: this.options.replyLanguage } : {}),
        ...(this.options.projectInstructions ? { projectInstructions: this.options.projectInstructions } : {}),
      },
      tools: registry.list(),
      question,
      maxTokens,
      ...(this.options.idSlot !== undefined ? { idSlot: this.options.idSlot } : {}),
      ...(signal ? { signal } : {}),
    });
  }

  /** Saves the KV state; false if the backend does not allow it. */
  async save(): Promise<boolean> {
    const { backend, kv, live } = this.options;
    if (!backend.slots) return false;
    await kv.saveState(
      backend.slots,
      this.options.idSlot ?? 0,
      this.conversationId,
      live,
    );
    return true;
  }
}

export { rebuildTranscript };
