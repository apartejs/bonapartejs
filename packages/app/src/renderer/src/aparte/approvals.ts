/**
 * The approvals the core asked for, as the window holds them. aparté's client
 * hands each call the core paused on to our `approvalResolver` — which owns
 * the decision: the page's own policy is never consulted — and the request
 * waits here until the person answers it on the card (or the turn is
 * stopped). The decision is the person's (`by: 'person'`): the core reads it
 * word for word. The client resumes the turn with it.
 */

import type { AparteTurnContext } from '@aparte/core';

export interface ApprovalRequest {
  /** The call's id. */
  id: string;
  conversationId: string | null;
  name: string;
  input: Record<string, unknown>;
  /** A sub-agent's call (task 8.2): who asks — the card names it. */
  agent?: { id: string; name?: string };
}

export interface ApprovalAnswer {
  approved: boolean;
  /** What the person said to do instead: the model reads it. */
  instruction?: string;
}

export interface ApprovalDecision extends ApprovalAnswer {
  by: 'person';
}

export interface ApprovalsStore {
  /** The requests waiting, of one conversation or of all. */
  list(conversationId?: string | null): ApprovalRequest[];
  ask(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision>;
  answer(id: string, answer: ApprovalAnswer): void;
  subscribe(listener: () => void): () => void;
}

export function createApprovalsStore(): ApprovalsStore {
  const waiting = new Map<string, { request: ApprovalRequest; settle: (decision: ApprovalDecision) => void }>();
  const listeners = new Set<() => void>();
  const changed = (): void => {
    for (const listener of [...listeners]) listener();
  };
  return {
    list(conversationId) {
      const all = [...waiting.values()].map((entry) => entry.request);
      return conversationId === undefined ? all : all.filter((request) => request.conversationId === conversationId);
    },
    ask(request, signal) {
      return new Promise((resolve) => {
        // A turn stopped before anyone answered: refused — aparté's client resumes nothing then.
        const stopped: ApprovalDecision = { approved: false, by: 'person' };
        if (signal.aborted) {
          resolve(stopped);
          return;
        }
        const settle = (decision: ApprovalDecision): void => {
          if (!waiting.delete(request.id)) return;
          signal.removeEventListener('abort', onAbort);
          resolve(decision);
          changed();
        };
        const onAbort = (): void => settle(stopped);
        signal.addEventListener('abort', onAbort, { once: true });
        waiting.set(request.id, { request, settle });
        changed();
      });
    },
    answer(id, answer) {
      waiting.get(id)?.settle({ ...answer, by: 'person' });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * The resolver aparté's client calls for each call the core paused on. The
 * call is filed under the conversation of its turn, which aparté gives with
 * it: a call asked again as its conversation loads is filed there, before
 * React has rendered which one is open.
 */
export function createApprovalResolver(store: ApprovalsStore) {
  return (
    call: { id: string; name: string; input: Record<string, unknown>; agent?: { id: string; name?: string } },
    signal: AbortSignal,
    turn?: AparteTurnContext,
  ): Promise<ApprovalDecision> =>
    store.ask(
      {
        id: call.id,
        conversationId: turn?.conversationId ?? null,
        name: call.name,
        input: call.input,
        ...(call.agent ? { agent: call.agent } : {}),
      },
      signal,
    );
}

/**
 * « Pour cette conversation », « Toujours … » (audit 2026-11-21, D3): the core remembers first, then the call is
 * allowed — the calls queued behind it are decided with the rule kept. A rule the core could not keep still answers
 * the call: the person allowed it.
 */
export async function rememberAndAllow(steps: { remember(): Promise<unknown>; allow(): void }): Promise<void> {
  await steps.remember().catch(() => undefined);
  steps.allow();
}

/**
 * « Autoriser et passer en Plume »: the core takes the new mode first, then the call is allowed —
 * the calls queued behind it are decided in the mode the person just chose. A mode the core could
 * not take still answers the call: the person allowed it.
 */
export async function allowAndSwitch(steps: { setMode(): Promise<void>; allow(): void }): Promise<void> {
  await steps.setMode().catch(() => undefined);
  steps.allow();
}
