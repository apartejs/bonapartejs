/**
 * ChatSession — orchestre pour UNE conversation active : prompt figé,
 * PromptLog append-only, boucle agentique (outils + permissions), persistance
 * des événements et save/restore d'état KV via le manifest strict.
 */

import { AgentLoop, type AgentEvent, type ApprovalResolver } from '../agent/loop.js';
import type { Backend } from '../backend/types.js';
import {
  rebuildPromptLog,
  type ConversationStore,
} from '../conversation/store.js';
import type {
  KvStore,
  LiveBackendConfig,
  RestoreOutcome,
} from '../kv/kv-store.js';
import type { PermissionEngine } from '../permissions/engine.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { PromptLog } from '../wire/qwen-template.js';
import {
  buildSystemPrompt,
  renderInventoryDelta,
} from '../wire/system-prompt.js';

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
    private readonly log: PromptLog,
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

    // Le prompt système est figé à la première ouverture et réutilisé
    // verbatim : le reconstruire le ferait varier avec l'inventaire et
    // casserait le préfixe du cache KV.
    let meta = await store.meta(conversationId);
    if (!meta.systemPrompt) {
      const systemPrompt = buildSystemPrompt({
        projectRoot: options.projectRoot,
        tools: registry.list(),
        ...(options.replyLanguage ? { replyLanguage: options.replyLanguage } : {}),
        ...(options.projectInstructions
          ? { projectInstructions: options.projectInstructions }
          : {}),
      });
      await store.freezeSystemPrompt(
        conversationId,
        systemPrompt,
        registry.list().map((d) => d.name),
      );
      meta = await store.meta(conversationId);
    }

    const events = await store.loadEvents(conversationId);
    const log = rebuildPromptLog(meta.systemPrompt ?? '', events);

    const loop = new AgentLoop({
      backend,
      registry,
      permissions: options.permissions,
      projectRoot: options.projectRoot,
      ...(options.approve ? { approve: options.approve } : {}),
      ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
      ...(options.idSlot !== undefined ? { idSlot: options.idSlot } : {}),
    });

    const session = new ChatSession(options, conversationId, log, loop);

    // L'outillage a-t-il bougé depuis le figeage ? Si oui : message de
    // service APPENDÉ (jamais de re-rendu du prompt système).
    await session.announceInventoryDelta(meta.toolNames ?? []);

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

  private async announceInventoryDelta(frozenNames: string[]): Promise<void> {
    const { registry, store } = this.options;
    const message = renderInventoryDelta(
      registry.diff({ names: frozenNames, hash: '' }),
    );
    if (!message) return;

    this.log.appendUser(message);
    await store.appendEvent(this.conversationId, {
      type: 'service',
      text: message,
      at: new Date().toISOString(),
    });
    await store.setFrozenTools(
      this.conversationId,
      registry.list().map((d) => d.name),
    );
  }

  /**
   * Envoie un message et déroule la boucle agentique. Chaque mutation du
   * PromptLog annoncée par la boucle est persistée dans le même ordre : le
   * rejeu reconstruit un prompt octet-identique.
   */
  async *send(text: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const { store } = this.options;
    const now = (): string => new Date().toISOString();

    await store.appendEvent(this.conversationId, {
      type: 'user',
      text,
      at: now(),
    });

    const effective = signal ?? new AbortController().signal;
    for await (const event of this.loop.run(this.log, text, effective)) {
      if (event.type === 'assistant_committed') {
        await store.appendEvent(this.conversationId, {
          type: 'assistant',
          raw: event.raw,
          thinking: event.thinking,
          at: now(),
        });
      } else if (event.type === 'service_appended') {
        await store.appendEvent(this.conversationId, {
          type: 'service',
          text: event.text,
          at: now(),
        });
      }
      yield event;
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

export { rebuildPromptLog };
