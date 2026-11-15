/**
 * The approvals the core asked for, as the window holds them: aparté's client
 * hands each paused call to our resolver (it owns the decision: the page's
 * policy is never consulted), the request waits in the store until the
 * person answers on the card — or the turn is stopped — and the client
 * resumes the turn with the answer.
 */

import { describe, expect, it } from 'vitest';
import { createApprovalResolver, createApprovalsStore } from './approvals';

const CALL = { id: 'call-1', name: 'edit_file', input: { path: 'a.ts' } };

describe('the approvals store and its resolver', () => {
  it('a paused call waits until the person answers, and the answer is the decision, by the person', async () => {
    const store = createApprovalsStore();
    const resolve = createApprovalResolver(store, () => 'c-1');
    const decision = resolve(CALL, new AbortController().signal);
    expect(store.list('c-1')).toEqual([{ id: 'call-1', conversationId: 'c-1', name: 'edit_file', input: { path: 'a.ts' } }]);
    store.answer('call-1', { approved: false, instruction: 'Use notes.md.' });
    await expect(decision).resolves.toEqual({ approved: false, instruction: 'Use notes.md.', by: 'person' });
    expect(store.list('c-1')).toEqual([]);
  });

  it('a turn stopped while it waits: the request goes, refused (the client resumes nothing then)', async () => {
    const store = createApprovalsStore();
    const controller = new AbortController();
    const decision = createApprovalResolver(store, () => 'c-1')(CALL, controller.signal);
    controller.abort();
    await expect(decision).resolves.toEqual({ approved: false, by: 'person' });
    expect(store.list()).toEqual([]);
  });

  it('tells its listeners when a request comes and goes; keeps each conversation apart', async () => {
    const store = createApprovalsStore();
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.list().length));
    const resolve = createApprovalResolver(store, () => 'c-1');
    void resolve(CALL, new AbortController().signal);
    expect(store.list('c-2')).toEqual([]);
    store.answer('call-1', { approved: true });
    expect(seen).toEqual([1, 0]);
  });
});
