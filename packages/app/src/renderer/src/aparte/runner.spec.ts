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
});
