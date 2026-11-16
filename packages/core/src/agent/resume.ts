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
 *   said, to ask about pauses the turn again;
 * - a sub-agent's calls (task 8.1): handed to it — it runs or reads them and
 *   goes on to its result, which answers its `run_subagent` call; refusing one
 *   stops only it. A `run_subagent` queued behind: its sub-agent runs now.
 */

import { toolRefusal, type StreamRunEvent } from '@aparte/engine';
import type { JournalEntry, Outcome, PendingCall, SubagentHold } from '../journal/types.js';
import { RUN_SUBAGENT } from '../tools/builtin/run-subagent.js';
import { capToolOutput } from '../tools/output-cap.js';
import type { ToolResult } from '../tools/types.js';
import type { CallScope, SubagentEnd } from './calls.js';
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

export interface AnswerContext extends Omit<CallScope, 'windowTools' | 'subagents'> {
  /** The tools the window runs (its `clientTools`): one queued waits for the window when its turn comes. */
  windowTools?: ReadonlySet<string>;
  /** The conversation's sub-agents: the one a call belongs to goes on; a queued `run_subagent` runs (task 8.1). */
  subagents?: {
    resume(hold: SubagentHold, outcomes: Record<string, Outcome>): Promise<SubagentEnd>;
    run(call: PendingCall): Promise<SubagentEnd>;
    idOf(toolCallId: string): string;
  };
}

/** Answers the calls of a pause, in order: their results, and those that must wait again. */
export async function answerPause(
  ctx: AnswerContext,
  pause: Pause,
  outcomes: Record<string, Outcome>,
  emit: (event: StreamRunEvent) => void,
): Promise<{ results: ToolResult[]; waiting: PendingCall[]; holds: SubagentHold[] }> {
  const results: ToolResult[] = [];
  const waiting: PendingCall[] = [];
  // The `run_subagent` calls whose sub-agent still waits: kept with the next pause.
  const holds: SubagentHold[] = [];
  const handed = new Set<string>();
  let refused = false;
  const holdOf = (agentId: string): SubagentHold | undefined => pause.subagents?.find((hold) => hold.agentId === agentId);
  /** A sub-agent's end: the result of its `run_subagent` call, or its calls waiting again. */
  const settle = (hold: SubagentHold, end: SubagentEnd): void => {
    if (end.kind === 'paused') {
      waiting.push(...end.pending);
      holds.push(hold);
      return;
    }
    const content = capToolOutput(end.result, ctx.nCtx);
    if (end.kind === 'done') emit({ type: 'tool-resolved', toolCallId: hold.toolCallId, result: content });
    else if (end.kind === 'stopped') emit({ type: 'tool-aborted', toolCallId: hold.toolCallId, cause: 'stopped' });
    else emit({ type: 'tool-failed', toolCallId: hold.toolCallId, error: content });
    results.push({ toolCallId: hold.toolCallId, name: hold.name, content, ...(end.kind === 'done' ? {} : { failed: true }) });
  };
  // `granted`: the person allowed this very call — a write outside the project goes where the card showed.
  const run = async (call: PendingCall, granted = false): Promise<void> => {
    const effect = ctx.registry.get(call.name)?.def.effect;
    if ((effect === 'write' || effect === 'execute') && ctx.beforeChange) {
      const place = await ctx.beforeChange();
      if (place && 'error' in place) {
        emit({ type: 'tool-failed', toolCallId: call.toolCallId, error: place.error });
        results.push({ toolCallId: call.toolCallId, name: call.name, content: place.error, failed: true });
        return;
      }
      if (place) {
        ctx.place.roots = place.roots;
        ctx.place.barred = place.barred;
      }
    }
    const result = await ctx.registry.run(
      { id: call.toolCallId, name: call.name, input: call.input },
      {
        conversationId: ctx.conversationId,
        roots: ctx.place.roots,
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
      // A sub-agent's call queued behind: its call aside stays with the pause.
      const hold = call.agentId ? holdOf(call.agentId) : undefined;
      if (hold && !holds.includes(hold)) holds.push(hold);
      continue;
    }
    if (call.agentId && ctx.subagents) {
      // A sub-agent's calls go back to it, all of them at once; its refusal stops only it.
      if (handed.has(call.agentId)) continue;
      handed.add(call.agentId);
      const hold = holdOf(call.agentId);
      if (!hold) {
        emit({ type: 'tool-failed', toolCallId: call.toolCallId, error: 'Its sub-agent is gone.' });
        continue;
      }
      const theirs = Object.fromEntries(
        pause.calls.filter((one) => one.agentId === call.agentId && outcomes[one.toolCallId]).map((one) => [one.toolCallId, outcomes[one.toolCallId]!]),
      );
      settle(hold, await ctx.subagents.resume(hold, theirs));
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
    if (call.name === RUN_SUBAGENT && ctx.subagents && !refused) {
      // A sub-agent queued behind the pause: it runs now, on a slot of its own.
      const hold: SubagentHold = { toolCallId: call.toolCallId, agentId: ctx.subagents.idOf(call.toolCallId), name: call.name, input: call.input };
      settle(hold, await ctx.subagents.run(call));
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
      roots: ctx.place.roots,
      ...(ctx.place.barred ? { barred: ctx.place.barred } : {}),
      ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
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
  return { results, waiting, holds };
}
