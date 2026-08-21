/**
 * ChatSession — orchestre pour UNE conversation active : transcript sémantique,
 * boucle agentique (outils + permissions), persistance des événements et
 * save/restore d'état KV via le manifest strict.
 *
 * Elle ne connaît AUCUN détail de fournisseur : elle passe un transcript et un
 * `SystemSpec` au backend, qui en dérive sa propre représentation.
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
   * Racines du projet, ORDONNÉES. Vide = conversation sans projet : les outils
   * marchent, simplement sans confinement.
   */
  roots?: string[];
  live: LiveBackendConfig;
  /** Langue attendue des réponses (ex. « French ») — le fil reste anglais. */
  replyLanguage?: string;
  projectInstructions?: string;
  approve?: ApprovalResolver;
  maxTurns?: number;
  idSlot?: number;
  /** Échantillonnage de la conversation, réglable sans invalider le cache. */
  sampling?: SamplingParams;
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

    // Le backend fige ce qu'il doit figer MAINTENANT (prompt système pour
    // llama.cpp), pas au premier tour.
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

    // L'outillage a-t-il bougé depuis le figeage ? Si oui : message de
    // service APPENDÉ (jamais de re-rendu du prompt système).
    await session.announceInventoryDelta(meta.toolNames);
    // Le décor a-t-il changé depuis le figeage ? Même règle : on appende.
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

    // Première ouverture : rien à annoncer, on note juste l'inventaire de
    // référence (et l'état que le backend aura figé au premier tour).
    if (frozenNames === undefined) {
      await store.freezeBackendState(
        this.conversationId,
        backend.exportState?.(this.conversationId),
        names,
      );
      // Le décor est figé en même temps que l'inventaire : sans ça, la
      // réouverture croirait qu'un projet vient d'apparaître et annoncerait
      // un changement qui n'a pas eu lieu.
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
   * Le prompt système est figé à la création : si le périmètre a bougé depuis
   * — dossier ajouté, retiré, ou simplement RÉORDONNÉ, ce qui change la racine
   * par défaut des chemins relatifs — le modèle travaillerait sur un décor
   * périmé. On l'annonce par un message APPENDÉ, jamais par un re-rendu.
   */
  private async announcePerimeterDelta(frozen: string[]): Promise<void> {
    const current = this.options.roots ?? [];
    const message = renderPerimeterDelta(frozen, current);
    if (!message) return;

    await this.appendService(message);
    await this.options.store.setFrozenRoots(this.conversationId, current);
  }

  /** Message de service : dans le transcript ET dans le log, jamais dans l'UI. */
  private async appendService(text: string): Promise<void> {
    this.transcript.push({ role: 'service', text });
    await this.options.store.appendEvent(this.conversationId, {
      type: 'service',
      text,
      at: new Date().toISOString(),
    });
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
