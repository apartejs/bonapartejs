/**
 * Serves a turn of conversation: a `Request` in, a streamed `Response` out,
 * the shape of aparté's own agent handler. The window reaches it through
 * Electron's `protocol.handle`, with aparté's stock runner.
 *
 * Text only for now: the prompt is rendered from the messages of the request,
 * and the answer is streamed back as it is generated. The journal, the KV
 * memory and the tools arrive in the next phases.
 */

import type { Core } from '../api.js';
import type { LlamaCppHttpClient } from '../backend/llamacpp/http-client.js';
import type { CompletionStats } from '../backend/types.js';
import { familyLayer, type DemuxEvent } from '../families/index.js';
import { PromptLog } from '../prompt/prompt-log.js';
import { agentBodySchema, messageText, type AgentBody } from './body.js';
import { encodeEvent, type RunEvent, type WireLine } from './run-events.js';

/**
 * Where the window posts a turn: `bonaparte://app/agent/c/<conversation>`.
 * Declared in `shared`, because the window needs it too.
 */
export { AGENT_ENDPOINT } from '@aparte/bonaparte-shared';

/** Stands in until the layered system prompt of the next phase. Sent to the model: English. */
const SYSTEM_PROMPT = 'You are bonaparte, a coding agent that runs on this machine.';

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
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
    if (!body.success) {
      return jsonError(400, 'Body must be { v: 1, providerId?, messageId, request: { messages }, clientTools }.');
    }

    const engine = await core.engine();
    if (!engine) {
      return jsonError(409, 'No engine is configured: choose a model, or connect a service, before sending a message.');
    }
    return streamTurn(engine, body.data, request.signal);
  };
}

/** The conversation, rendered once in the model's template, ready for the next answer. */
function renderPrompt(messages: AgentBody['request']['messages']): string {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => messageText(message.content))
    .join('\n\n');
  // Qwen until the family is read from the model (task 2.7).
  const log = new PromptLog(familyLayer('qwen'));
  log.appendSystem(system || SYSTEM_PROMPT);
  for (const message of messages) {
    if (message.role === 'user') {
      log.appendUser(messageText(message.content));
    } else if (message.role === 'assistant') {
      log.beginAssistantTurn({ thinking: true });
      log.completeAssistantTurn(messageText(message.content));
    }
  }
  return log.beginAssistantTurn({ thinking: true });
}

/** Text and reasoning go to the window; a tool call has nobody to run it yet (phase 4). */
function toRunEvent(piece: DemuxEvent): RunEvent | null {
  if (piece.type === 'thinking') return { type: 'thinking-delta', delta: piece.delta };
  if (piece.type === 'text') return { type: 'text-delta', delta: piece.delta };
  return null;
}

function streamTurn(engine: LlamaCppHttpClient, body: AgentBody, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  // Stops the generation: when the window cuts its request, or stops reading.
  const stop = new AbortController();
  if (signal.aborted) stop.abort();
  else signal.addEventListener('abort', () => stop.abort(), { once: true });

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
        const demux = familyLayer('qwen').createDemux();
        const forward = (pieces: DemuxEvent[]): void => {
          for (const piece of pieces) {
            const event = toRunEvent(piece);
            if (event) write(event);
          }
        };
        let stats: CompletionStats | undefined;
        const completion = engine.complete({
          prompt: renderPrompt(body.request.messages),
          cachePrompt: true,
          returnProgress: true,
          signal: stop.signal,
        });
        for await (const event of completion) {
          if (event.type === 'token') forward(demux.push(event.text));
          else if (event.type === 'done') stats = event.stats;
        }
        forward(demux.flush());
        if (stop.signal.aborted) {
          // A stop ends the run cleanly: the reply is over, not failed.
          write({ type: 'run-aborted' });
          write({ type: 'run-done' });
          return;
        }
        if (!stats) {
          // The engine went away in the middle of its answer. Nobody stopped
          // it: saying so is the difference between a cut reply and a failure.
          write({ type: 'run-error', message: 'The engine ended its answer before finishing it.' });
          return;
        }
        const inputTokens = stats.progress?.total ?? stats.promptUncachedTokens;
        write({
          type: 'run-done',
          usage: {
            inputTokens,
            outputTokens: stats.predictedTokens,
            totalTokens: inputTokens + stats.predictedTokens,
            cacheReadTokens: stats.progress?.cache ?? 0,
            durationMs: Date.now() - started,
          },
          finishReason: stats.truncated ? 'length' : 'stop',
        });
      };

      void run()
        .catch((error: unknown) => {
          if (stop.signal.aborted) {
            write({ type: 'run-aborted' });
            write({ type: 'run-done' });
          } else {
            const reason = error instanceof Error ? error.message : String(error);
            write({ type: 'run-error', message: `The engine failed: ${reason.slice(0, 300)}` });
          }
        })
        .finally(close);
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
