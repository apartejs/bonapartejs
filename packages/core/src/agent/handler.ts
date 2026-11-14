/**
 * Serves a turn of conversation: a `Request` in, a streamed `Response` out,
 * the shape of aparté's own agent handler. The window reaches it through
 * Electron's `protocol.handle`, with aparté's stock runner.
 *
 * The journal is the truth: the history aparté sends is compared with it
 * (`divergence.ts`) — a new message, the last answer asked again, a message
 * changed (both make a branch), or a history that is not this
 * conversation's (409). The turn runs on the conversation engine, which
 * restores the memory or reads it again; what it waits for is said as
 * aparté's steps (`slot-wait`, `restore`, `seed`, `reread` — keys the window
 * translates), and a re-read's progress as a `reread` activity. A turn never
 * loads a model: with none loaded, it is refused.
 */

import type { Core, Engine } from '../api.js';
import { ContextFullError, EngineFailedError, type TurnEvent, type TurnInput, type TurnResult } from '../conversation/engine.js';
import { openJournal } from '../journal/journal.js';
import { agentBodySchema, type AgentBody } from './body.js';
import { compareWithJournal } from './divergence.js';
import { encodeEvent, type WireLine } from './run-events.js';

/**
 * Where the window posts a turn: `bonaparte://app/agent/c/<conversation>`.
 * Declared in `shared`, because the window needs it too.
 */
export { AGENT_ENDPOINT } from '@aparte/bonaparte-shared';

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** v1 reads no image: said before anything runs. */
function hasImage(body: AgentBody): boolean {
  return body.request.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'image'));
}

export function createAgentHandler(core: Core): (request: Request) => Promise<Response> {
  return async (request) => {
    const conversationId = /^\/agent\/c\/([^/]+)$/.exec(new URL(request.url).pathname)?.[1];
    if (!conversationId) return jsonError(404, 'Not found.');
    if (request.method !== 'POST') return jsonError(405, 'A turn is sent with POST.');
    // A cross-site form cannot send application/json: refusing anything else
    // keeps a page of another origin from posting a turn.
    if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) {
      return jsonError(415, 'The body must be application/json.');
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError(400, 'Invalid JSON body.');
    }
    if ((raw as { v?: unknown } | null)?.v !== 1) {
      return jsonError(400, 'Unsupported agent wire version: expected v 1.');
    }
    const body = agentBodySchema.safeParse(raw);
    if (!body.success || body.data.request.messages.length === 0) {
      return jsonError(400, 'Body must be { v: 1, providerId?, messageId, request: { messages }, clientTools }.');
    }
    if (hasImage(body.data)) {
      return jsonError(400, 'The built-in engine reads no image: send text, or describe what the image shows.');
    }

    let engine: Engine | undefined;
    try {
      engine = await core.engine();
    } catch (error) {
      // A server that does not answer, a model the engine cannot speak, a
      // configuration that cannot be read: said, never a silent load.
      return jsonError(409, error instanceof Error ? error.message : String(error));
    }
    if (!engine) {
      return jsonError(409, 'No model is loaded: choose one, or connect a service, before sending a message.');
    }

    let meta;
    try {
      meta =
        (await core.conversationStore.get(conversationId)) ??
        (await core.conversationStore.create(
          { kind: 'code', engineId: 'builtin', modelId: (await core.engineState()).model?.name ?? '', mode: 'repetition' },
          conversationId,
        ));
    } catch (error) {
      return jsonError(400, error instanceof Error ? error.message : String(error));
    }
    const entries = (await openJournal(core.conversationStore.dir, conversationId, meta.branchId)).entries();
    const divergence = compareWithJournal(body.data.request.messages, entries);
    if (divergence.kind === 'mismatch') {
      return jsonError(409, 'This history is not the one of this conversation: open it again.');
    }
    const input: TurnInput =
      divergence.kind === 'append'
        ? { text: divergence.text, messageId: body.data.messageId }
        : divergence.kind === 'retry'
          ? { forkAfter: divergence.afterEntryId }
          : { text: divergence.text, forkAfter: divergence.afterEntryId, messageId: body.data.messageId };
    return streamTurn(core, conversationId, input, request.signal);
  };
}

/** What the engine says while it works, in aparté's words. */
function toWire(event: TurnEvent, rereading: { on: boolean }): WireLine | null {
  switch (event.type) {
    case 'text':
      return { type: 'text-delta', delta: event.delta };
    case 'thinking':
      return { type: 'thinking-delta', delta: event.delta };
    case 'step':
      if (event.name === 'reread') rereading.on = event.phase === 'start';
      return { type: event.phase === 'start' ? 'step-start' : 'step-end', name: event.name };
    case 'progress':
      // The progress of a prompt read again: the bar of the `reread` activity.
      return rereading.on
        ? { type: 'activity', id: 'reread', activityType: 'reread', content: { done: event.done, total: event.total } }
        : null;
    default:
      // A tool call has nobody to run it yet (phase 4).
      return null;
  }
}

function streamTurn(core: Core, conversationId: string, input: TurnInput, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  // Stops the generation: when the window cuts its request, or stops reading.
  const stop = new AbortController();
  if (signal.aborted) stop.abort();
  else signal.addEventListener('abort', () => stop.abort(), { once: true });
  // The engine is not unloaded while a turn works.
  const release = core.hold();

  // False once the reader is gone: nothing more can be written.
  let open = true;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (line: WireLine): void => {
        if (open) controller.enqueue(encoder.encode(encodeEvent(line)));
      };
      const close = (): void => {
        if (open) controller.close();
        open = false;
      };

      const run = async (): Promise<void> => {
        const started = Date.now();
        write({ type: 'run-start' });
        write({ type: 'turn-start' });
        const rereading = { on: false };
        const result: TurnResult = await core.conversations.turn(
          conversationId,
          input,
          (event) => {
            const line = toWire(event, rereading);
            if (line) write(line);
          },
          stop.signal,
        );
        if (result.stopped === 'user') {
          // A stop ends the run cleanly: the reply is over, not failed.
          write({ type: 'run-aborted' });
          write({ type: 'run-done' });
          return;
        }
        const { usage } = result;
        write({
          type: 'run-done',
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.inputTokens + usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens ?? 0,
            durationMs: Date.now() - started,
          },
          finishReason: 'stop',
        });
      };

      void run()
        .catch((error: unknown) => {
          if (stop.signal.aborted) {
            write({ type: 'run-aborted' });
            write({ type: 'run-done' });
            return;
          }
          if (error instanceof ContextFullError) {
            write({ type: 'run-error', message: error.message, code: 'context-full' });
            return;
          }
          const reason = error instanceof EngineFailedError ? error.message : `The engine failed: ${error instanceof Error ? error.message : String(error)}`;
          write({ type: 'run-error', message: reason.slice(0, 400) });
        })
        .finally(() => {
          release();
          close();
        });
    },
    // The reader went away (the window dropped the response): stop generating.
    cancel() {
      open = false;
      stop.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
  });
}
