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

import { playModeSchema } from '@aparte/bonaparte-shared';
import type { StreamRunEvent } from '@aparte/engine';
import type { Core, Engine } from '../api.js';
import { ContextFullError, EngineFailedError, type TurnEvent, type TurnInput, type TurnResult } from '../conversation/engine.js';
import { openJournal } from '../journal/journal.js';
import { agentBodySchema, type AgentBody } from './body.js';
import { compareWithJournal } from './divergence.js';
import { encodeEvent, type WireLine } from './run-events.js';
import { turnEventToWire } from './wire.js';

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

/** A branch's name as git takes it from the window: no option, no `..`, no space — else none. */
function refName(value: string | null): string | null {
  // A name git takes, in any language (`bonaparte/réunion`): letters, digits, `_`, then `.`, `/` and `-` too.
  return value && /^[\p{L}\p{N}_][\p{L}\p{N}_./-]{0,99}$/u.test(value) && !value.includes('..') && !value.endsWith('/') && !value.endsWith('.lock') ? value : null;
}

/**
 * A conversation's first turn: what the window chose before it had any — the page may have saved the
 * conversation already, made in the default mode. After that, the core's choices stand. Both paths, the
 * built-in engine and a service, start a conversation through it.
 */
async function applyFirstTurn(core: Core, conversationId: string, url: URL): Promise<void> {
  const chosen = playModeSchema.safeParse(url.searchParams.get('mode'));
  // Started in a project: it belongs to it, and runs in its default mode unless the person chose one.
  const project = await core.projects.get(url.searchParams.get('project') ?? '');
  if (project) await core.conversationStore.update(conversationId, { projectId: project.id });
  // Without a project, a discussion when the window says so (task 9.7): in Lecture, whatever mode was shown.
  const discussion = !project && url.searchParams.get('kind') === 'discussion';
  if (discussion) {
    await core.conversationStore.update(conversationId, { kind: 'discussion' });
    await core.setMode(conversationId, 'lecture', { confirmed: false });
  }
  const mode = discussion ? undefined : chosen.success ? chosen.data : project?.defaultMode;
  // Only a mode the person picked in this run confirms Impro: a default read from disk does not
  // (security rule 9) — the window says `picked=1` when the person chose it in the switch.
  const picked = chosen.success && url.searchParams.get('picked') === '1';
  if (mode) await core.setMode(conversationId, mode, { confirmed: picked });
  // On its own branch (task 6.7): chosen before its first message, made at its first write.
  if (project && url.searchParams.get('worksIn') === 'branch') {
    const branch = refName(url.searchParams.get('branch'));
    const base = refName(url.searchParams.get('base'));
    await core.conversationStore.update(conversationId, { worksIn: 'branch', ...(branch ? { branch } : {}), ...(base ? { base } : {}) });
  }
}

export function createAgentHandler(core: Core): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    const conversationId = /^\/agent\/c\/([^/]+)$/.exec(url.pathname)?.[1];
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

    // A conversation on a service (task 9.2): the service's own loop, through aparté's handler — never the
    // built-in engine, which it does not need.
    // Started on a service the person picked before the first message (task 9.3): the first turn names it.
    const asked = url.searchParams.get('provider');
    if (asked && asked !== 'builtin' && (await core.startOnService(conversationId, asked, url.searchParams.get('model') ?? ''))) {
      // Its first turn: what the window chose before it — a project, a discussion, a mode, a branch — as on the
      // built-in engine (review of phase 9: a discussion started on a service got every tool of a code one).
      await applyFirstTurn(core, conversationId, url);
    }
    if (await core.serviceOf(conversationId)) return core.turnOnService(conversationId, raw as Record<string, unknown>, request);

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
      meta = await core.conversationStore.ensure(conversationId, {
        kind: 'code',
        engineId: 'builtin',
        modelId: (await core.engineState()).model?.path ?? '',
        mode: 'repetition',
      });
    } catch (error) {
      return jsonError(400, error instanceof Error ? error.message : String(error));
    }
    const { messageId, clientTools, resume } = body.data;
    if (resume) {
      // A paused turn goes on: its ticket checked, its calls answered — the history the window sends is not read.
      const check = await core.checkResume(conversationId, { messageId, ticket: resume.ticket, outcomes: resume.outcomes });
      if (!check.ok) return jsonError(check.status, check.message);
      return streamTurn(
        core,
        (emit, onTurnEvent, signal) => core.resumeTurn(conversationId, check, { messageId, clientTools, signal }, emit, onTurnEvent),
        request.signal,
      );
    }
    const entries = (await openJournal(core.conversationStore.dir, conversationId, meta.branchId)).entries();
    if (entries.length === 0) await applyFirstTurn(core, conversationId, url);
    const divergence = compareWithJournal(body.data.request.messages, entries, body.data.request._meta?.historySummary);
    if (divergence.kind === 'mismatch') {
      return jsonError(409, 'This history is not the one of this conversation: open it again.');
    }
    const input: TurnInput =
      divergence.kind === 'append'
        ? { text: divergence.text, messageId: body.data.messageId }
        : divergence.kind === 'retry'
          ? { forkAfter: divergence.afterEntryId, messageId: body.data.messageId }
          : { text: divergence.text, forkAfter: divergence.afterEntryId, messageId: body.data.messageId };
    return streamTurn(
      core,
      (emit, onTurnEvent, signal) => core.agentTurn(conversationId, input, { clientTools, signal }, emit, onTurnEvent),
      request.signal,
    );
  };
}

/** What leads a turn: a new one, or a pause resumed. */
type TurnRunner = (emit: (event: StreamRunEvent) => void, onTurnEvent: (event: TurnEvent) => void, signal: AbortSignal) => Promise<TurnResult>;

function streamTurn(core: Core, runTurn: TurnRunner, signal: AbortSignal): Response {
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
        const result: TurnResult = await runTurn(
          (event) => write(event),
          (event) => {
            const line = turnEventToWire(event, rereading);
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
        if (result.suspended) {
          // The turn waits for a person, or for the window: the page answers, and resumes with the ticket.
          write({
            type: 'run-suspended',
            pending: result.suspended.pending,
            usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.inputTokens + usage.outputTokens },
            ticket: result.suspended.ticket,
          });
          return;
        }
        write({
          type: 'run-done',
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.inputTokens + usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens ?? 0,
            durationMs: Date.now() - started,
          },
          // Cut off by the context: aparté says so under the answer.
          finishReason: result.truncated ? 'length' : 'stop',
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
