/**
 * The questions the model asks the person (`ask_user`), as the chats put them on screen — a hidden chat
 * included — so that « À traiter » answers one from outside its conversation (aparté 1.12,
 * `observeElicitations`, apartejs/aparte#250). Whichever answers first is the answer: the page, or the
 * conversation's own composer. Approvals are not here: the client's `approvalResolver` decides them.
 */

import { aparteGlobalConfig, type AparteConfig, type AparteElicitationPending } from '@aparte/core';

export interface QuestionsLive {
  /** The question a conversation waits on now, if it is put on screen. */
  of(conversationId: string): AparteElicitationPending | undefined;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** A choice of a question with options: what the page shows, and what answering it sends. */
export interface QuestionChoice {
  label: string;
  value: unknown;
}

/** The choices of a question that is one choice among options; null for anything else (free text, several). */
export function choicesOf(pending: AparteElicitationPending): QuestionChoice[] | null {
  const schema = pending.request.schema as { type?: string; options?: readonly Record<string, unknown>[] } | undefined;
  if (schema?.type !== 'enum' || !Array.isArray(schema.options) || schema.options.length === 0) return null;
  return schema.options.map((option) => {
    const label = option['label'] ?? option['title'] ?? option['value'];
    return { label: typeof label === 'string' ? label : String(label), value: option['value'] };
  });
}

export function createQuestionsLive(config: AparteConfig = aparteGlobalConfig): QuestionsLive {
  const live = new Map<string, AparteElicitationPending>();
  const listeners = new Set<() => void>();
  const tell = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const stop = config.observeElicitations((pending) => {
    const conversationId = pending.request.conversationId;
    if (pending.request.kind === 'approval' || !conversationId) return;
    live.set(conversationId, pending);
    tell();
    void pending.settled.then(() => {
      if (live.get(conversationId) !== pending) return;
      live.delete(conversationId);
      tell();
    });
  });
  return {
    of: (conversationId) => live.get(conversationId),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose: stop,
  };
}
