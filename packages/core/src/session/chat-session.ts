/**
 * ChatSession — orchestre pour UNE conversation active : transcript sémantique,
 * boucle agentique (outils + permissions), persistance des événements et
 * save/restore d'état KV via le manifest strict.
 *
 * Elle ne connaît AUCUN détail de fournisseur : elle passe un transcript et un
 * `SystemSpec` au backend, qui en dérive sa propre représentation.
 */

import { AgentLoop, type AgentEvent, type ApprovalResolver } from '../agent/loop.js';
import type { Backend, TranscriptEntry } from '../backend/types.js';
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
import { renderInventoryDelta } from '../wire/system-prompt.js';

export interface ChatSessionOptions {
  backend: Backend;
  kv: KvStore;
  store: ConversationStore;
  registry: ToolRegistry;
  permissions: PermissionEngine;
  /** Racine du projet ouvert : contexte des outils et du prompt. */
  projectRoot: string;
  live: LiveBackendConfig;
  /** Langue attendue des réponses (ex. « French ») — le fil reste anglais. */
  replyLanguage?: string;
  projectInstructions?: string;
  approve?: ApprovalResolver;
  maxTurns?: number;
  idSlot?: number;
}

export type OpenResult = {
  session: ChatSession;
  /** 'unsupported' : le backend n'a pas la capacité kvPersistence. */
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

    // L'état backend (prompt figé pour llama.cpp) est rendu au backend tel
    // quel : le reconstruire le ferait dériver avec l'inventaire.
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
        projectRoot: options.projectRoot,
        ...(options.replyLanguage ? { replyLanguage: options.replyLanguage } : {}),
        ...(options.projectInstructions
          ? { projectInstructions: options.projectInstructions }
          : {}),
      },
      ...(options.approve ? { approve: options.approve } : {}),
      ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
      ...(options.idSlot !== undefined ? { idSlot: options.idSlot } : {}),
    });

    // Le backend fige ce qu'il doit figer MAINTENANT (prompt système pour
    // llama.cpp), pas au premier tour.
    backend.prepareConversation?.(
      conversationId,
      {
        projectRoot: options.projectRoot,
        ...(options.replyLanguage ? { replyLanguage: options.replyLanguage } : {}),
        ...(options.projectInstructions
          ? { projectInstructions: options.projectInstructions }
          : {}),
      },
      registry.list(),
    );

    const session = new ChatSession(options, conversationId, transcript, loop);

    // L'outillage a-t-il bougé depuis le figeage ? Si oui : message de
    // service APPENDÉ (jamais de re-rendu du prompt système).
    await session.announceInventoryDelta(meta.toolNames);

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

    // Première ouverture : rien à annoncer, on note juste l'inventaire de
    // référence (et l'état que le backend aura figé au premier tour).
    if (frozenNames === undefined) {
      await store.freezeBackendState(
        this.conversationId,
        backend.exportState?.(this.conversationId),
        names,
      );
      return;
    }

    const message = renderInventoryDelta(
      registry.diff({ names: frozenNames, hash: '' }),
    );
    if (!message) return;

    this.transcript.push({ role: 'service', text: message });
    await store.appendEvent(this.conversationId, {
      type: 'service',
      text: message,
      at: new Date().toISOString(),
    });
    await store.setFrozenTools(this.conversationId, names);
  }

  /**
   * Envoie un message et déroule la boucle agentique. Chaque mutation du
   * transcript annoncée par la boucle est persistée dans le même ordre : le
   * rejeu reconstruit un transcript identique.
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

    // Le backend a peut-être figé son état au premier tour (prompt système).
    const state = backend.exportState?.(this.conversationId);
    if (state !== undefined) {
      await store.freezeBackendState(
        this.conversationId,
        state,
        this.options.registry.list().map((d) => d.name),
      );
    }
  }

  /** Sauvegarde l'état KV ; false si le backend ne le permet pas. */
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
