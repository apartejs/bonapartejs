/**
 * ChatSession — orchestre pour UNE conversation active : PromptLog (templating
 * déterministe), backend (/completion), persistance des événements, et
 * save/restore d'état KV via le manifest strict.
 */

import type { Backend, CompletionEvent } from '../backend/types.js';
import {
  rebuildPromptLog,
  type ConversationStore,
} from '../conversation/store.js';
import type {
  KvStore,
  LiveBackendConfig,
  RestoreOutcome,
} from '../kv/kv-store.js';
import type { PromptLog } from '../wire/qwen-template.js';

export interface ChatSessionOptions {
  backend: Backend;
  kv: KvStore;
  store: ConversationStore;
  systemPrompt: string;
  live: LiveBackendConfig;
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
  ) {}

  static async open(
    options: ChatSessionOptions,
    conversationId: string,
  ): Promise<OpenResult> {
    const { store, backend, kv, live, systemPrompt } = options;

    if (!(await store.exists(conversationId))) {
      await store.create(conversationId);
    }
    const events = await store.loadEvents(conversationId);
    const log = rebuildPromptLog(systemPrompt, events);
    const session = new ChatSession(options, conversationId, log);

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

  async *send(
    text: string,
    turn: { thinking: boolean },
  ): AsyncIterable<CompletionEvent> {
    const { backend, store } = this.options;
    const now = (): string => new Date().toISOString();

    this.log.appendUser(text);
    await store.appendEvent(this.conversationId, {
      type: 'user',
      text,
      at: now(),
    });

    const prompt = this.log.beginAssistantTurn({ thinking: turn.thinking });

    let raw = '';
    try {
      for await (const event of backend.complete({
        prompt,
        idSlot: this.options.idSlot ?? 0,
        cachePrompt: true,
        returnProgress: true,
      })) {
        if (event.type === 'token') raw += event.text;
        yield event;
      }
    } finally {
      // Même en cas d'interruption, l'historique gèle ce qui a été généré :
      // le préfixe reste cohérent avec ce que le serveur a réellement vu.
      this.log.completeAssistantTurn(raw);
    }

    await store.appendEvent(this.conversationId, {
      type: 'assistant',
      raw,
      thinking: turn.thinking,
      at: now(),
    });
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
