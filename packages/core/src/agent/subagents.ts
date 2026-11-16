/**
 * A conversation's sub-agents (task 8.1). The model hands a piece of work to
 * one (`run_subagent`); it works with a context of its own — its thread kept
 * apart — and the tools it was given, never more than its conversation may:
 * the conversation's mode decides its calls, and its approvals name it. It
 * runs on the slot its conversation's turn lends it, or, its pause answered,
 * on one it takes like any owner. On the wire: `agent-start`, its events
 * under its `agentId`, then `agent-end`; only its result goes back to the
 * conversation, as the result of the `run_subagent` call.
 */

import { createHash } from 'node:crypto';
import type { StreamRunEvent } from '@aparte/engine';
import type { CallsAnswer, CallsSlot, ConversationEngine, ModelCall, TurnEvent, TurnResult } from '../conversation/engine.js';
import type { Outcome, PendingCall, SubagentHold } from '../journal/types.js';
import { readSubagentSpec, RUN_SUBAGENT, type SubagentSpec } from '../tools/builtin/run-subagent.js';
import type { ToolSet } from '../tools/registry.js';
import type { ToolDef } from '../tools/types.js';
import { answerCalls, type CallScope, type SubagentEnd, type SubagentRunner } from './calls.js';
import { answerPause, NOT_RUN_STOPPED } from './resume.js';
import { turnEventToWire } from './wire.js';

export const DEFAULT_SUBAGENT_ROUNDS = 25;

/** What the engine gives a sub-agent: its turns, its pause, the answers to it. */
export type SubagentEngine = Pick<ConversationEngine, 'subagentTurn' | 'subagentPaused' | 'recordSubagentAnswers'>;

/** What a conversation's sub-agents inherit of its turn: its mode, its tools, its place, its signal — never more. */
export interface SubagentParent extends Omit<CallScope, 'agentId' | 'subagents' | 'windowTools'> {
  engine: SubagentEngine;
  emit(event: StreamRunEvent): void;
  maxToolRounds?: number;
}

/**
 * A sub-agent's id: a name-based UUID of its conversation and of the call that launched it — the same across
 * its pause and its resume, never the same for two calls (call ids are random).
 */
export function subagentId(conversationId: string, toolCallId: string): string {
  const hex = createHash('sha256').update(`${conversationId}/${toolCallId}`).digest('hex');
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `agent-${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The tools a sub-agent may call: read and search only, or all the core's — never the window's, never another sub-agent. */
function toolsFor(registry: ToolSet, spec: SubagentSpec): ToolSet {
  const allowed = (def: ToolDef): boolean =>
    def.where === 'core' && def.name !== RUN_SUBAGENT && (spec.tools === 'all' || def.effect === 'read');
  const get: ToolSet['get'] = (name) => {
    const tool = registry.get(name);
    return tool && allowed(tool.def) ? tool : undefined;
  };
  return {
    list: () => registry.list().filter(allowed),
    get,
    run: (call, ctx) =>
      get(call.name)
        ? registry.run(call, ctx)
        : Promise.resolve({ toolCallId: call.id, name: call.name, content: `There is no tool named ${call.name}.`, failed: true }),
  };
}

/** What the sub-agent reads before its mission: who it is, what it may use, where, and what to give back. English. */
function noteFor(spec: SubagentSpec, tools: readonly ToolDef[], roots: readonly string[]): string {
  return [
    `You are a sub-agent named ${spec.name}. The main agent of this conversation gave you the mission below;`,
    'you see nothing else of its conversation, and nobody else reads what you write but your last answer.',
    `Work on your own with these tools only: ${tools.map((tool) => tool.name).join(', ') || 'none'}.`,
    roots.length > 0 ? `You work in: ${roots.join(', ')}.` : '',
    'Never ask the person anything. When you are done, answer with your result only: what the main agent needs, briefly. It is all that goes back to it.',
  ]
    .filter(Boolean)
    .join('\n');
}

const statusOf = (end: SubagentEnd): 'done' | 'stopped' | 'failed' | 'waiting' => (end.kind === 'paused' ? 'waiting' : end.kind);

/** Runs a sub-agent's turn and says its end: its events under its id on the way, then `agent-end`. */
async function drive(
  parent: SubagentParent,
  agentId: string,
  spec: SubagentSpec,
  turn: (scope: CallScope, sink: (event: TurnEvent) => void, onCalls: (calls: readonly ModelCall[], slot?: CallsSlot) => Promise<CallsAnswer>) => Promise<TurnResult & { answer: string }>,
): Promise<SubagentEnd> {
  const { emit } = parent;
  const scope = scopeOf(parent, agentId, spec);
  const maxRounds = parent.maxToolRounds ?? DEFAULT_SUBAGENT_ROUNDS;
  let rounds = 0;
  const onCalls = async (calls: readonly ModelCall[]): Promise<CallsAnswer> => {
    rounds += 1;
    if (rounds > maxRounds) {
      emit({ type: 'turn-limit-exceeded', scope: 'global', limit: maxRounds, agentId });
      return { stop: 'limit' };
    }
    const answer = await answerCalls(scope, calls, emit);
    // Its own pause needs no ticket: its conversation's covers the calls it waits on.
    return 'pending' in answer ? { suspend: { pending: answer.pending, ticket: '', results: answer.results } } : { results: answer.results };
  };
  const rereading = { on: false };
  const sink = (event: TurnEvent): void => {
    const line = turnEventToWire(event, rereading, agentId);
    if (line) emit(line);
  };
  let end: SubagentEnd;
  try {
    const done = await turn(scope, sink, onCalls);
    if (done.suspended) end = { kind: 'paused', pending: done.suspended.pending };
    else if (done.stopped) end = { kind: 'stopped', result: done.answer || NOT_RUN_STOPPED };
    else end = { kind: 'done', result: done.answer || 'The sub-agent gave no answer.' };
  } catch (error) {
    end = { kind: 'failed', result: `The sub-agent failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  emit({
    type: 'agent-end',
    agentId,
    status: statusOf(end),
    ...(end.kind === 'done' ? { result: end.result } : end.kind === 'failed' ? { error: end.result } : {}),
  });
  return end;
}

function scopeOf(parent: SubagentParent, agentId: string, spec: SubagentSpec): CallScope {
  const { engine: _engine, emit: _emit, maxToolRounds: _rounds, registry, ...inherited } = parent;
  return { ...inherited, registry: toolsFor(registry, spec), agentId };
}

function announce(parent: SubagentParent, hold: { agentId: string; toolCallId: string }, spec: SubagentSpec): void {
  parent.emit({ type: 'agent-start', agentId: hold.agentId, name: spec.name, description: spec.mission, toolCallId: hold.toolCallId });
}

/** The conversation's sub-agents, for its loop: announced with their step, run one after another. */
export function subagentRunner(parent: SubagentParent): SubagentRunner {
  const idOf = (call: ModelCall): string => subagentId(parent.conversationId, call.id);
  return {
    idOf,
    announce(call, waits) {
      const spec = readSubagentSpec(call.input);
      if ('error' in spec) return;
      const agentId = idOf(call);
      announce(parent, { agentId, toolCallId: call.id }, spec);
      if (waits) parent.emit({ type: 'step-start', name: 'slot-wait', agentId });
    },
    async run(call, slot, waited) {
      const spec = readSubagentSpec(call.input);
      if ('error' in spec) return { kind: 'failed', result: spec.error };
      const agentId = idOf(call);
      if (waited) parent.emit({ type: 'step-end', name: 'slot-wait', agentId });
      return drive(parent, agentId, spec, (scope, sink, onCalls) =>
        parent.engine.subagentTurn(
          parent.conversationId,
          { agentId, name: spec.name },
          { start: { note: noteFor(spec, scope.registry.list(), scope.place.roots), mission: spec.mission }, tools: { defs: scope.registry.list(), onCalls } },
          sink,
          { ...(slot ? { lend: slot.lend } : {}), signal: parent.signal },
        ),
      );
    },
  };
}

/** A `run_subagent` call the turn queued behind a pause: its sub-agent runs now, on a slot of its own. */
export function runQueuedSubagent(parent: SubagentParent, call: PendingCall): Promise<SubagentEnd> {
  const runner = subagentRunner(parent);
  const asCall: ModelCall = { id: call.toolCallId, name: call.name, input: (call.input ?? {}) as Record<string, unknown> };
  runner.announce(asCall, false);
  return runner.run(asCall, undefined, false);
}

/**
 * A sub-agent's pause answered (its calls' outcomes): its approved calls run, a refusal is read — by it only —
 * and it goes on, on a slot it takes like any owner, to its result or to another pause.
 */
export async function resumeSubagent(parent: SubagentParent, hold: SubagentHold, outcomes: Record<string, Outcome>): Promise<SubagentEnd> {
  const read = readSubagentSpec(hold.input);
  const spec: SubagentSpec = 'error' in read ? { name: hold.name, mission: '', tools: 'read' } : read;
  const { agentId } = hold;
  // The same line goes on: the same agentId, the same call.
  announce(parent, hold, spec);
  const pause = await parent.engine.subagentPaused(parent.conversationId, agentId);
  if (!pause) {
    const end: SubagentEnd = { kind: 'failed', result: 'The sub-agent was waiting for nothing: its pause is gone.' };
    parent.emit({ type: 'agent-end', agentId, status: 'failed', error: end.result });
    return end;
  }
  const scope = scopeOf(parent, agentId, spec);
  const say = (event: StreamRunEvent): void => parent.emit({ ...event, agentId } as StreamRunEvent);
  const { windowTools: _window, subagents: _none, ...answering } = scope;
  const { results, waiting } = await answerPause(answering, pause, outcomes, say);
  await parent.engine.recordSubagentAnswers(parent.conversationId, agentId, {
    outcomes,
    results,
    ...(waiting.length > 0 ? { pending: { calls: waiting.map((call) => ({ ...call, agentId })), ticket: '' } } : {}),
  });
  if (waiting.length > 0) {
    const end: SubagentEnd = { kind: 'paused', pending: waiting.map((call) => ({ ...call, agentId })) };
    parent.emit({ type: 'agent-end', agentId, status: 'waiting' });
    return end;
  }
  return drive(parent, agentId, spec, (_scope, sink, onCalls) =>
    parent.engine.subagentTurn(
      parent.conversationId,
      { agentId, name: spec.name },
      { resume: true, tools: { defs: scope.registry.list(), onCalls } },
      sink,
      { signal: parent.signal },
    ),
  );
}
