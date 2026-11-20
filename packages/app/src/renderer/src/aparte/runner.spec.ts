/**
 * The window's runner is aparté's stock one, pointed at the conversation of
 * the turn: since aparté 1.9 each turn carries the id of the conversation
 * open when it was sent (apartejs/aparte#209). The core's steps keep their
 * keys in the stream; the page labels them (`step-labels.ts`).
 */

import { describe, expect, it } from 'vitest';
import { createConversationRunner } from './runner';

type Runner = ReturnType<typeof createConversationRunner>;
type Options = Parameters<Runner>[0];

/** A core that answers one turn with these lines, and records where it was posted. */
function answering(lines: object[]) {
  const posted: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    posted.push(String(input));
    return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(''), {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, posted };
}

function turn(conversationId: string | undefined, events: { type: string; name?: string }[] = []): Options {
  return {
    messageId: 'm1',
    ...(conversationId ? { conversationId } : {}),
    baseRequest: { messages: [{ role: 'user', content: 'Bonjour' }], modelId: '' },
    emitter: (event: { type: string; name?: string }) => events.push(event),
    signal: new AbortController().signal,
  } as unknown as Options;
}

describe('createConversationRunner', () => {
  it('posts each turn to the conversation it belongs to', async () => {
    const { fetch, posted } = answering([{ type: 'run-start' }, { type: 'run-done' }]);
    const runner = createConversationRunner({ fetch });
    await runner(turn('c-1'));
    await runner(turn('c-2'));
    expect(posted).toEqual(['bonaparte://app/agent/c/c-1', 'bonaparte://app/agent/c/c-2']);
  });

  it('says what each turn is doing, once each time it changes (task 12.2: the mascot reads it)', async () => {
    const { fetch } = answering([
      { type: 'run-start' },
      { type: 'step-start', name: 'restore' },
      { type: 'thinking-delta', delta: 'hm' },
      { type: 'text-delta', delta: 'Bon' },
      { type: 'text-delta', delta: 'jour' },
      { type: 'run-done' },
    ]);
    const said: string[] = [];
    const runner = createConversationRunner({ fetch, onActivity: (conversationId, activity) => said.push(`${conversationId}:${activity}`) });
    await runner(turn('c-1'));
    expect(said).toEqual(['c-1:reading', 'c-1:thinking', 'c-1:writing', 'c-1:done']);
  });

  it("keeps the core's step keys as they are: the page labels them", async () => {
    const { fetch } = answering([{ type: 'run-start' }, { type: 'step-start', name: 'reread' }, { type: 'step-end', name: 'reread' }, { type: 'run-done' }]);
    const events: { type: string; name?: string }[] = [];
    await createConversationRunner({ fetch })(turn('c-1', events));
    expect(events.filter((event) => event.type.startsWith('step-'))).toEqual([
      expect.objectContaining({ type: 'step-start', name: 'reread' }),
      expect.objectContaining({ type: 'step-end', name: 'reread' }),
    ]);
  });

  it('refuses a turn that belongs to no conversation, rather than post it nowhere', async () => {
    const { fetch, posted } = answering([]);
    await expect(createConversationRunner({ fetch })(turn(undefined))).rejects.toThrow(/conversation/);
    expect(posted).toEqual([]);
  });

  it('tells the core the mode the person chose: a conversation the turn creates runs in it', async () => {
    const { fetch, posted } = answering([{ type: 'run-start' }, { type: 'run-done' }]);
    let mode: 'lecture' | 'plume' = 'lecture';
    const runner = createConversationRunner({ fetch, mode: () => mode });
    await runner(turn('c-1'));
    mode = 'plume';
    await runner(turn('c-1'));
    expect(posted).toEqual(['bonaparte://app/agent/c/c-1?mode=lecture', 'bonaparte://app/agent/c/c-1?mode=plume']);
  });

  it('tells the core that « /plugin » asked the tools that make a plugin, for that conversation only (audit I2)', async () => {
    const { fetch, posted } = answering([{ type: 'run-start' }, { type: 'run-done' }]);
    const runner = createConversationRunner({ fetch, plugins: (id) => id === 'c-1' });
    await runner(turn('c-1'));
    await runner(turn('c-2'));
    expect(posted).toEqual(['bonaparte://app/agent/c/c-1?plugins=1', 'bonaparte://app/agent/c/c-2']);
  });

  it('tells the core the project a new conversation starts in, beside the mode', async () => {
    const { fetch, posted } = answering([{ type: 'run-start' }, { type: 'run-done' }]);
    let project: string | null = 'p-1';
    const runner = createConversationRunner({ fetch, mode: () => 'plume', project: () => project });
    await runner(turn('c-1'));
    project = null;
    await runner(turn('c-2'));
    expect(posted).toEqual(['bonaparte://app/agent/c/c-1?mode=plume&project=p-1', 'bonaparte://app/agent/c/c-2?mode=plume']);
  });
});

