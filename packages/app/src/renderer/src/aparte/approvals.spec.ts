/**
 * The approvals the core asked for, as the window holds them: aparté's client
 * hands each paused call to our resolver (it owns the decision: the page's
 * policy is never consulted), the request waits in the store until the
 * person answers on the card — or the turn is stopped — and the client
 * resumes the turn with the answer.
 */

import { describe, expect, it } from 'vitest';
import { allowAndSwitch, createApprovalResolver, createApprovalsStore } from './approvals';

const CALL = { id: 'call-1', name: 'edit_file', input: { path: 'a.ts' } };
const TURN = { conversationId: 'c-1', messageId: 'm-1' };

describe('the approvals store and its resolver', () => {
  it('a paused call waits until the person answers, and the answer is the decision, by the person', async () => {
    const store = createApprovalsStore();
    const resolve = createApprovalResolver(store);
    const decision = resolve(CALL, new AbortController().signal, TURN);
    expect(store.list('c-1')).toEqual([{ id: 'call-1', conversationId: 'c-1', name: 'edit_file', input: { path: 'a.ts' } }]);
    store.answer('call-1', { approved: false, instruction: 'Use notes.md.' });
    await expect(decision).resolves.toEqual({ approved: false, instruction: 'Use notes.md.', by: 'person' });
    expect(store.list('c-1')).toEqual([]);
  });

  it('a turn stopped while it waits: the request goes, refused (the client resumes nothing then)', async () => {
    const store = createApprovalsStore();
    const controller = new AbortController();
    const decision = createApprovalResolver(store)(CALL, controller.signal, TURN);
    controller.abort();
    await expect(decision).resolves.toEqual({ approved: false, by: 'person' });
    expect(store.list()).toEqual([]);
  });

  it('tells its listeners when a request comes and goes; keeps each conversation apart', async () => {
    const store = createApprovalsStore();
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.list().length));
    const resolve = createApprovalResolver(store);
    void resolve(CALL, new AbortController().signal, TURN);
    expect(store.list('c-2')).toEqual([]);
    store.answer('call-1', { approved: true });
    expect(seen).toEqual([1, 0]);
  });

  it('a call paused before a reload is asked about in the conversation of its turn, whatever the page shows', async () => {
    // aparté asks again on loading a conversation (resumeDeferred), before React has rendered which
    // one is open; since 1.10 the resolver is told the turn the call belongs to (apartejs/aparte#221).
    const store = createApprovalsStore();
    void createApprovalResolver(store)(CALL, new AbortController().signal, { conversationId: 'c-9', messageId: 'm-9' });
    expect(store.list('c-9')).toHaveLength(1);
    void createApprovalResolver(store)({ ...CALL, id: 'call-2' }, new AbortController().signal, { messageId: 'm-0' });
    expect(store.list().map((request) => request.conversationId)).toEqual(['c-9', null]);
  });

  it('« Autoriser et passer en Plume »: the core changes mode first, then the call is allowed — the calls queued behind it are decided in Plume', async () => {
    let switched: () => void = () => undefined;
    const order: string[] = [];
    const done = allowAndSwitch({
      setMode: () =>
        new Promise<void>((resolve) => {
          switched = () => {
            order.push('mode');
            resolve();
          };
        }),
      allow: () => order.push('allow'),
    });
    await Promise.resolve();
    expect(order).toEqual([]);
    switched();
    await done;
    expect(order).toEqual(['mode', 'allow']);
  });

  it('a mode the core could not take still answers the call: the person allowed it', async () => {
    const order: string[] = [];
    await allowAndSwitch({ setMode: () => Promise.reject(new Error('gone')), allow: () => order.push('allow') });
    expect(order).toEqual(['allow']);
  });
});

