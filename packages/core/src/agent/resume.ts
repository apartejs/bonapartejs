/**
 * A paused turn resumed: the ticket checked, then each call it waited on
 * answered, in order, as aparté's server loop does —
 *
 * - approved: `tool-approved`, the registry runs it, `tool-resolved` or
 *   `tool-failed`;
 * - refused: `tool-rejected { by: 'person' }` with aparté's sentence (the
 *   person's words quoted when they gave some), which the model reads; the
 *   calls after it in the step are not run (`earlier-refusal`);
 * - the window's tool: its result, or its failure;
 * - queued behind another: through the gate afresh — allowed runs, refused is
 *   said, to ask about pauses the turn again.
 */

import type { PlayMode } from '@aparte/bonaparte-shared';
import { toolRefusal, type StreamRunEvent } from '@aparte/engine';
import type { JournalEntry, Outcome, PendingCall } from '../journal/types.js';
import type { PermissionEngine } from '../permissions/engine.js';
import type { ToolSet } from '../tools/registry.js';
import type { ToolContext, ToolResult } from '../tools/types.js';
import type { Tickets } from './tickets.js';

export type Pause = Extract<JournalEntry, { kind: 'pending' }>;

/** What the model reads of a call the person stopped before it ran. */
export const NOT_RUN_STOPPED = 'Not run: the person stopped the turn.';

export type ResumeCheck =
  | { ok: true; pause: Pause; outcomes: Record<string, Outcome> }
  | { ok: false; status: 400 | 409; message: string };

function readOutcome(raw: unknown): Outcome | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const outcome = raw as Record<string, unknown>;
  if (outcome['kind'] === 'decision' && typeof outcome['approved'] === 'boolean') {
    return {
      kind: 'decision',
      approved: outcome['approved'],
      ...(typeof outcome['reason'] === 'string' ? { reason: outcome['reason'] } : {}),
      ...(typeof outcome['instruction'] === 'string' ? { instruction: outcome['instruction'] } : {}),
    };
  }
  if (outcome['kind'] === 'result' && typeof outcome['content'] === 'string') {
    return {
      kind: 'result',
      content: outcome['content'],
      ...(outcome['structuredContent'] !== undefined ? { structuredContent: outcome['structuredContent'] } : {}),
    };
  }
  if (outcome['kind'] === 'failed' && typeof outcome['error'] === 'string') return { kind: 'failed', error: outcome['error'] };
  return null;
}

/** Is this a resume of the pause the conversation waits on, signed here, answered whole? */
export function checkResume(
  pause: Pause | null,
  resume: { messageId: string; ticket: string; outcomes: Record<string, unknown> },
  tickets: Tickets,
): ResumeCheck {
  if (!pause) return { ok: false, status: 409, message: 'Nothing waits in this conversation: the pause was answered already, or there was none.' };
  const verdict = tickets.verifyTicket(resume.ticket, { messageId: resume.messageId, calls: pause.calls.map((call) => call.toolCallId) });
  if (!verdict.ok) return { ok: false, status: 400, message: `This ticket resumes nothing here (${verdict.reason}).` };
  if (resume.ticket !== pause.ticket) return { ok: false, status: 409, message: 'This ticket is of an earlier pause: the conversation waits on another one.' };
  const outcomes: Record<string, Outcome> = {};
  for (const call of pause.calls) {
    const raw = resume.outcomes[call.toolCallId];
    if (raw === undefined) {
      if (call.reason === 'queued') continue;
      return { ok: false, status: 400, message: `Incomplete answers: the call ${call.toolCallId} (${call.name}) has none.` };
    }
    const outcome = readOutcome(raw);
    if (!outcome) return { ok: false, status: 400, message: `The answer to the call ${call.toolCallId} is not one.` };
    outcomes[call.toolCallId] = outcome;
  }
  return { ok: true, pause, outcomes };
}

export interface AnswerContext {
  conversationId: string;
  mode: PlayMode;
  projectId?: string;
  registry: ToolSet;
  permissions: PermissionEngine;
  roots: readonly string[];
  nCtx: number;
  signal: AbortSignal;
  /** The tools the window runs (its `clientTools`): one queued waits for the window when its turn comes. */
  windowTools?: ReadonlySet<string>;
  /** Before and after a tool writes a file: its original kept for the turn (checkpoints). */
  beforeWrite?: ToolContext['beforeWrite'];
  afterWrite?: ToolContext['afterWrite'];
  onOutput?: ToolContext['onOutput'];
}

/** Answers the calls of a pause, in order: their results, and those that must wait again. */
export async function answerPause(
  ctx: AnswerContext,
  pause: Pause,
  outcomes: Record<string, Outcome>,
  emit: (event: StreamRunEvent) => void,
): Promise<{ results: ToolResult[]; waiting: PendingCall[] }> {
  const results: ToolResult[] = [];
  const waiting: PendingCall[] = [];
  let refused = false;
  // `granted`: the person allowed this very call — a write outside the project goes where the card showed.
  const run = async (call: PendingCall, granted = false): Promise<void> => {
    const result = await ctx.registry.run(
      { id: call.toolCallId, name: call.name, input: call.input },
      {
        conversationId: ctx.conversationId,
        roots: ctx.roots,
        nCtx: ctx.nCtx,
        signal: ctx.signal,
        ...(granted ? { granted } : {}),
        ...(ctx.beforeWrite ? { beforeWrite: ctx.beforeWrite } : {}),
        ...(ctx.afterWrite ? { afterWrite: ctx.afterWrite } : {}),
        ...(ctx.onOutput ? { onOutput: ctx.onOutput } : {}),
      },
    );
    emit(
      result.failed
        ? { type: 'tool-failed', toolCallId: call.toolCallId, error: result.content }
        : {
            type: 'tool-resolved',
            toolCallId: call.toolCallId,
            result: result.content,
            ...(result.structuredContent !== undefined ? { structuredResult: result.structuredContent } : {}),
          },
    );
    results.push(result);
  };
  const reject = (call: PendingCall, refusal: ReturnType<typeof toolRefusal>): void => {
    emit({ type: 'tool-rejected', toolCallId: call.toolCallId, ...refusal });
    results.push({ toolCallId: call.toolCallId, name: call.name, content: refusal.reason, failed: true });
  };

  for (const call of pause.calls) {
    if (ctx.signal.aborted) {
      // Stopped while the pause was answered: nothing more runs.
      emit({ type: 'tool-aborted', toolCallId: call.toolCallId, cause: 'stopped' });
      results.push({ toolCallId: call.toolCallId, name: call.name, content: NOT_RUN_STOPPED, failed: true });
      continue;
    }
    if (waiting.length > 0) {
      waiting.push({ ...call, reason: 'queued' });
      continue;
    }
    if (refused) {
      reject(call, toolRefusal({ by: 'earlier-refusal' }));
      continue;
    }
    const outcome = outcomes[call.toolCallId];
    if (call.reason === 'external') {
      if (outcome?.kind === 'result') {
        emit({
          type: 'tool-resolved',
          toolCallId: call.toolCallId,
          result: outcome.content,
          ...(outcome.structuredContent !== undefined ? { structuredResult: outcome.structuredContent } : {}),
        });
        results.push({
          toolCallId: call.toolCallId,
          name: call.name,
          content: outcome.content,
          ...(outcome.structuredContent !== undefined ? { structuredContent: outcome.structuredContent } : {}),
        });
      } else {
        const error = outcome?.kind === 'failed' ? outcome.error : 'The window gave no result.';
        emit({ type: 'tool-failed', toolCallId: call.toolCallId, error });
        results.push({ toolCallId: call.toolCallId, name: call.name, content: error, failed: true });
      }
      continue;
    }
    if (call.reason === 'approval') {
      if (outcome?.kind === 'decision' && outcome.approved) {
        emit({ type: 'tool-approved', toolCallId: call.toolCallId });
        await run(call, true);
      } else {
        refused = true;
        const decision = outcome?.kind === 'decision' ? outcome : {};
        reject(call, toolRefusal({ ...decision, by: 'person' }));
      }
      continue;
    }
    // Queued behind another call: the window's own waits for the window; the core's goes through the gate afresh.
    if (ctx.windowTools?.has(call.name)) {
      waiting.push({ ...call, reason: 'external' });
      continue;
    }
    const tool = ctx.registry.get(call.name);
    if (!tool) {
      await run(call);
      continue;
    }
    const verdict = ctx.permissions.evaluate({
      tool: tool.def,
      input: call.input,
      mode: ctx.mode,
      ...(ctx.projectId !== undefined ? { projectId: ctx.projectId } : {}),
    });
    if (verdict.verdict === 'deny') {
      reject(call, toolRefusal({ reason: verdict.reason, by: 'policy' }));
    } else if (verdict.verdict === 'ask') {
      emit({ type: 'tool-awaiting-approval', toolCallId: call.toolCallId, name: call.name, input: call.input });
      waiting.push({ ...call, reason: 'approval' });
    } else {
      await run(call);
    }
  }
  return { results, waiting };
}
