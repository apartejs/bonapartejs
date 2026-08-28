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
} from '../kv/kv-store.js';
import type { PermissionEngine } from '../permissions/engine.js';
import type { ToolRegistry } from '../tools/registry.js';
import { renderInventoryDelta, renderPerimeterDelta } from '../wire/system-prompt.js';

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
}

export type OpenResult = {
  session: ChatSession;
  /** 'unsupported': the backend does not have the kvPersistence capability. */
  restore: RestoreOutcome | { restored: false; reason: 'unsupported' };
};

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
    return { session, restore };
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

  /** Service message: in the transcript AND in the log, never in the UI. */
  private async appendService(text: string): Promise<void> {
    this.transcript.push({ role: 'service', text });
    await this.options.store.appendEvent(this.conversationId, {
      type: 'service',
      text,
      at: new Date().toISOString(),
    });
  }

  /**
   * Sends a message and runs the agentic loop. Every transcript mutation
   * announced by the loop is persisted in the same order: replaying
   * reconstructs an identical transcript.
   */
  async *send(text: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
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
