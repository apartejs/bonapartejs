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
import type { PlayMode } from '@aparte/bonaparte-shared';
import { EXTENSION_TOOLS } from '../tools/builtin/extensions.js';
import type { StreamRunEvent } from '@aparte/engine';
import { ContextFullError, type CallsAnswer, type CallsSlot, type ConversationEngine, type ModelCall, type TurnEvent, type TurnResult } from '../conversation/engine.js';
import type { Outcome, PendingCall, SubagentHold } from '../journal/types.js';
import { readSubagentSpec, RUN_SUBAGENT, type SubagentSpec } from '../tools/builtin/run-subagent.js';
import type { ToolSet } from '../tools/registry.js';
import type { ToolDef } from '../tools/types.js';
import { answerCalls, type CallScope, type SubagentEnd, type SubagentRunner } from './calls.js';
import { answerPause, NOT_RUN_STOPPED } from './resume.js';
import { turnEventToWire } from './wire.js';

export const DEFAULT_SUBAGENT_ROUNDS = 25;
/** The same call failing this many times in a row stops a sub-agent: it is not learning from what it reads. */
export const SAME_FAILURE_LIMIT = 3;

/** What the engine gives a sub-agent: its turns, its pause, the answers to it. */
export type SubagentEngine = Pick<ConversationEngine, 'subagentTurn' | 'subagentPaused' | 'recordSubagentAnswers'> &
  Partial<Pick<ConversationEngine, 'slotCount' | 'freeSlots'>> & {
    /** The service a sub-agent runs on, as its thread says (audit S1); null for the built-in engine's. */
    placeOf?(conversationId: string, agentId: string): Promise<{ engineId: string; model: string } | null>;
  };

/** What a conversation's sub-agents inherit of its turn: its mode, its tools, its place, its signal — never more. */
export interface SubagentParent extends Omit<CallScope, 'agentId' | 'subagents' | 'windowTools'> {
  engine: SubagentEngine;
  emit(event: StreamRunEvent): void;
  maxToolRounds?: number;
  /**
   * The model of the service its new sub-agents run on (audit S1, S3), named on their line; none: they run on the
   * conversation's engine, on its slot.
   */
  service?: { model: string };
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
    def.where === 'core' &&
    def.name !== RUN_SUBAGENT &&
    // Making a plugin is the conversation's own, with the person (task 11.4).
    !(EXTENSION_TOOLS as readonly string[]).includes(def.name) &&
    // Read only: a third party's plugin is not believed to only read (audit 13.4).
    (spec.tools === 'all' || (def.effect === 'read' && def.source !== 'extension'));
  const get: ToolSet['get'] = (name) => {
    const tool = registry.get(name);
    return tool && allowed(tool.def) ? tool : undefined;
  };
  const list = (): ToolDef[] => registry.list().filter(allowed);
  return {
    list,
    get,
    run: (call, ctx) =>
      get(call.name)
        ? registry.run(call, ctx)
        : Promise.resolve({ toolCallId: call.id, name: call.name, content: refusalOf(call.name, registry, spec, list()), failed: true }),
  };
}

/** A text's first sentence, at most 240 characters: what a failure was, without what follows it. */
function firstSentence(text: string): string {
  const end = text.search(/[.!?](\s|$)/);
  const sentence = end >= 0 ? text.slice(0, end + 1) : text;
  return sentence.length > 240 ? `${sentence.slice(0, 239)}…` : sentence;
}

/**
 * What a sub-agent reads when it calls a tool that is not its own. Its prompt shows the conversation's whole
 * inventory (it shares the conversation's frozen prompt), so it may well try one: the words say why not, and what to
 * do instead, so that it acts on them rather than trying again.
 */
function refusalOf(name: string, registry: ToolSet, spec: SubagentSpec, mine: readonly ToolDef[]): string {
  const theirs = registry.get(name)?.def;
  const yours = mine.map((def) => def.name).join(', ') || 'none';
  if (!theirs) return `There is no tool named ${name}. Your tools: ${yours}.`;
  const wouldBeAllowed = theirs.where === 'core' && theirs.name !== RUN_SUBAGENT && !(EXTENSION_TOOLS as readonly string[]).includes(theirs.name);
  if (spec.tools !== 'all' && wouldBeAllowed && theirs.effect !== 'read') {
    return [
      `${name} is not yours: this sub-agent reads and searches only (it was given the tools "read").`,
      `Do not call ${name} again. Do what your tools allow (${yours}), then answer the main agent with your result`,
      'and what is left for it to do — for a file to write, its path and its whole content.',
    ].join(' ');
  }
  return `${name} is not for a sub-agent: use your own tools (${yours}), then answer the main agent with your result.`;
}

/**
 * The tools a sub-agent's grammar admits: the whole inventory it reads in its prompt (the conversation's own), not
 * only those it may use. A grammar of its own tools alone bent a call it meant (write_file) into the nearest name it
 * was allowed (browser_read), again and again; now the call is written as meant, and refused in words it can act on.
 */
function seen(parent: SubagentParent): readonly ToolDef[] {
  return parent.registry.list();
}

/** Its conversation's mode, in one line: what passes, what is asked, what is refused. Sent to the model: English. */
const MODE_LINES: Record<PlayMode, string> = {
  lecture: 'Lecture: you read and search; writes and commands are refused.',
  repetition: 'Répétition: each change to a file and each command is asked to the user first; a refusal may say what to do instead.',
  plume: 'Plume: changes to files run without asking; commands are asked to the user first.',
  impro: 'Impro: changes and commands run without asking, except files that run later (package.json, git hooks, configuration files, .env), which are asked.',
};

/**
 * What the sub-agent reads before its mission (audit S2): that it starts with nothing else, its tools, its mode, how to
 * end. The person reads its transcript in the « Sous-agents » pane: nothing tells it it writes unseen. English.
 */
export function noteFor(spec: SubagentSpec, tools: readonly ToolDef[], roots: readonly string[], mode: PlayMode): string {
  return [
    `You are a sub-agent named ${spec.name}. You start with no context: the mission below is all you know of the main agent's work.`,
    `Use only these tools: ${tools.map((tool) => tool.name).join(', ') || 'none'}.`,
    roots.length > 0 ? `You work in: ${roots.join(', ')}.` : '',
    `Mode: ${MODE_LINES[mode]}`,
    'Never ask the user anything. If a call is refused, do not retry it.',
    'Your last message is your whole result for the main agent: give the answer first, then the evidence (paths with line numbers). If you could not finish, say what is left.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** What a sub-agent reads with the results of its last round of tools (audit S4). Sent to the model: English. */
export function roundsNote(rounds: number): string {
  return `You reached your limit of ${rounds} rounds of tools: answer now with what you found, and say what is left.`;
}

/** What the main agent reads of a sub-agent given its last answer early: cut, and what it found (audit S4, S5). */
function cutResult(concluded: NonNullable<TurnResult['concluded']>, rounds: number, answer: string): string {
  const why =
    concluded.why === 'rounds'
      ? `The sub-agent was cut after ${rounds} rounds of tools, before it finished.`
      : `The sub-agent was cut when its own context (${concluded.window} tokens) was nearly full, before it finished.`;
  return `${why} What it found:\n${answer || '(it said nothing)'}`;
}

/** What the main agent reads of a sub-agent that failed. Its context full is its own, never « the conversation » (S5). */
function failureOf(error: unknown): string {
  if (error instanceof ContextFullError) {
    const { used, window } = error.announcement;
    return (
      `The sub-agent's own context (${window} tokens) filled up: its prompt took ${used} of them, and what it found is lost. ` +
      'Give it a shorter mission that reads less, or do the work yourself.'
    );
  }
  return `The sub-agent failed: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Its status on the wire. A sub-agent cut short is not « done »: aparté has no status for it
 * (apartejs/aparte#285), so its line says it stopped, its result kept.
 */
const statusOf = (end: SubagentEnd): 'done' | 'stopped' | 'failed' | 'waiting' =>
  end.kind === 'paused' ? 'waiting' : end.kind === 'partial' ? 'stopped' : end.kind;

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
  // Nobody watches a sub-agent: the same call failing again and again stops it, said to the main agent.
  const repeats = { same: '', count: 0 };
  let stuck: string | undefined;
  const onCalls = async (calls: readonly ModelCall[]): Promise<CallsAnswer> => {
    rounds += 1;
    if (rounds > maxRounds) {
      emit({ type: 'turn-limit-exceeded', scope: 'global', limit: maxRounds, agentId });
      return { stop: 'limit' };
    }
    const answer = await answerCalls(scope, calls, emit);
    // Its own pause needs no ticket: its conversation's covers the calls it waits on.
    if ('pending' in answer) return { suspend: { pending: answer.pending, ticket: '', results: answer.results } };
    const failedAll = answer.results.length > 0 && answer.results.every((result) => result.failed);
    const same = failedAll ? JSON.stringify(calls.map((one) => [one.name, one.input])) : '';
    repeats.count = same !== '' && same === repeats.same ? repeats.count + 1 : same !== '' ? 1 : 0;
    repeats.same = same;
    if (repeats.count >= SAME_FAILURE_LIMIT) {
      const names = [...new Set(calls.map((one) => one.name))].join(', ');
      // What went wrong, in a sentence: never the advice the sub-agent was given (« do not call it again »).
      const why = answer.results.map((result) => firstSentence(result.content)).join(' ');
      stuck = `The sub-agent was stopped: it called ${names} the same way ${SAME_FAILURE_LIMIT} times in a row, and it failed each time (${why}). Do the work yourself, or give it a mission and tools that fit.`;
      return { stop: 'limit' };
    }
    // Its last round of tools: one more answer, without them, to say what it found (audit S4).
    if (rounds >= maxRounds) {
      emit({ type: 'turn-limit-exceeded', scope: 'global', limit: maxRounds, agentId });
      return { results: answer.results, last: { note: roundsNote(maxRounds), why: 'rounds' } };
    }
    return { results: answer.results };
  };
  const rereading = { on: false };
  const sink = (event: TurnEvent): void => {
    for (const line of turnEventToWire(event, rereading, agentId)) emit(line);
  };
  let end: SubagentEnd;
  try {
    const done = await turn(scope, sink, onCalls);
    if (stuck) end = { kind: 'failed', result: stuck };
    else if (done.overthought !== undefined) {
      end = {
        kind: 'failed',
        result: `The sub-agent was stopped: its reasoning ran past ${done.overthought} characters without acting. Give it a narrower mission, or do the work yourself.`,
      };
    }
    else if (done.suspended) end = { kind: 'paused', pending: done.suspended.pending };
    else if (done.stopped) end = { kind: 'stopped', result: done.answer || NOT_RUN_STOPPED };
    else if (done.concluded) end = { kind: 'partial', result: cutResult(done.concluded, maxRounds, done.answer) };
    else end = { kind: 'done', result: done.answer || 'The sub-agent gave no answer.' };
  } catch (error) {
    end = { kind: 'failed', result: failureOf(error) };
  }
  // Its last text whole before its end: aparté's parser may still hold a closing backtick.
  emit({ type: 'text-flush', agentId } as StreamRunEvent);
  emit({
    type: 'agent-end',
    agentId,
    status: statusOf(end),
    ...(end.kind === 'done' || end.kind === 'partial' ? { result: end.result } : end.kind === 'failed' ? { error: end.result } : {}),
  });
  return end;
}

function scopeOf(parent: SubagentParent, agentId: string, spec: SubagentSpec): CallScope {
  const { engine: _engine, emit: _emit, maxToolRounds: _rounds, registry, ...inherited } = parent;
  return { ...inherited, registry: toolsFor(registry, spec), agentId };
}

/**
 * Its name on its line: a sub-agent on a service says the model it runs on (audit S1) — aparté's line has no place
 * for a model (apartejs/aparte#286), so its name carries it.
 */
export function shownName(spec: SubagentSpec, model: string | undefined): string {
  return model ? `${spec.name} · ${model}` : spec.name;
}

function announce(parent: SubagentParent, hold: { agentId: string; toolCallId: string }, spec: SubagentSpec, model: string | undefined): void {
  parent.emit({ type: 'agent-start', agentId: hold.agentId, name: shownName(spec, model), description: spec.mission, toolCallId: hold.toolCallId });
}

/**
 * The tools its model is shown: on the built-in engine the whole inventory its shared prompt holds (its grammar),
 * on a service only its own — a service reads them from the request, not from a prompt it shares.
 */
const shownTools = (parent: SubagentParent, scope: CallScope, onService: boolean): readonly ToolDef[] => (onService ? scope.registry.list() : seen(parent));

/**
 * A sub-agent started now: its first turn, its note and its mission, on the engine its parent says. What
 * `subagentRunner` runs for a call of the loop, and the core for a call of aparté's handler (a service turn, S3).
 */
export function startSubagent(parent: SubagentParent, agentId: string, spec: SubagentSpec, slot?: CallsSlot): Promise<SubagentEnd> {
  return drive(parent, agentId, spec, (scope, sink, onCalls) =>
    parent.engine.subagentTurn(
      parent.conversationId,
      { agentId, name: spec.name },
      {
        start: { note: noteFor(spec, scope.registry.list(), scope.place.roots, scope.mode), mission: spec.mission, tools: scope.registry.list() },
        tools: { defs: shownTools(parent, scope, parent.service !== undefined), onCalls },
      },
      sink,
      { ...(slot ? { lend: slot.lend } : {}), signal: parent.signal },
    ),
  );
}

/** The conversation's sub-agents, for its loop: announced with their step, run one after another. */
export function subagentRunner(parent: SubagentParent): SubagentRunner {
  const idOf = (call: ModelCall): string => subagentId(parent.conversationId, call.id);
  return {
    idOf,
    free: () => ((parent.engine.slotCount ?? 1) > 1 ? (parent.engine.freeSlots ?? 0) : 0),
    announce(call, waits) {
      const spec = readSubagentSpec(call.input);
      if ('error' in spec) return;
      const agentId = idOf(call);
      announce(parent, { agentId, toolCallId: call.id }, spec, parent.service?.model);
      // On a service it waits for the one before it, never for the engine.
      if (waits && !parent.service) parent.emit({ type: 'step-start', name: 'slot-wait', agentId });
    },
    async run(call, slot, waited) {
      const spec = readSubagentSpec(call.input);
      if ('error' in spec) return { kind: 'failed', result: spec.error };
      const agentId = idOf(call);
      if (waited && !parent.service) parent.emit({ type: 'step-end', name: 'slot-wait', agentId });
      return startSubagent(parent, agentId, spec, slot);
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
  // Where it ran, it goes on: a service's model named on its line again.
  const place = (await parent.engine.placeOf?.(parent.conversationId, agentId)) ?? null;
  // The same line goes on: the same agentId, the same call.
  announce(parent, hold, spec, place?.model);
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
  // Its answer after the pause is a turn of its own: never added to the blocks it settled before it.
  parent.emit({ type: 'turn-start', agentId } as StreamRunEvent);
  return drive(parent, agentId, spec, (_scope, sink, onCalls) =>
    parent.engine.subagentTurn(
      parent.conversationId,
      { agentId, name: spec.name },
      { resume: true, tools: { defs: shownTools(parent, scopeOf(parent, agentId, spec), place !== null), onCalls } },
      sink,
      { signal: parent.signal },
    ),
  );
}
