/**
 * The calls of one round, answered one at a time in the order the model wrote
 * them, with the one approval policy and the one registry, and said to the
 * page in aparté's events — the conversation's and its sub-agents' alike (a
 * sub-agent's under its `agentId`):
 *
 * - allowed: `tool-start`, the registry runs it (writes and commands wait
 *   their turn there), then `tool-resolved` or `tool-failed`;
 * - refused by the policy: `tool-rejected { by: 'policy' }`, and the model
 *   reads aparté's refusal sentence as the call's result;
 * - to ask about: `tool-awaiting-approval`, and the round pauses — the calls
 *   after it wait, `queued`; the calls before it keep their results;
 * - a tool of the window (`ask_user`): the round pauses for the window;
 * - `run_subagent`: its sub-agent runs (task 8.1) — announced with those of
 *   the step after it, which wait for the slot and say so.
 */

import type { PlayMode } from '@aparte/bonaparte-shared';
import { toolRefusal, type StreamRunEvent } from '@aparte/engine';
import type { CallsSlot, ModelCall } from '../conversation/engine.js';
import type { PendingCall, SubagentHold } from '../journal/types.js';
import type { PermissionEngine } from '../permissions/engine.js';
import { RUN_SUBAGENT } from '../tools/builtin/run-subagent.js';
import { capToolOutput } from '../tools/output-cap.js';
import type { ToolSet } from '../tools/registry.js';
import type { ToolContext, ToolDef, ToolResult } from '../tools/types.js';
import { NOT_RUN_STOPPED } from './resume.js';

/** Where a conversation works from its first change on, or why it cannot move there. */
export type ChangePlace = { roots: readonly string[]; barred: readonly string[] } | { error: string };

/** Where the tools run: moved, for the conversation and its sub-agents alike, when it goes to its own branch. */
export interface Place {
  roots: readonly string[];
  barred?: readonly string[];
}

/** How a sub-agent ended: its result for the conversation, or the calls it waits on the person for. */
export type SubagentEnd =
  | { kind: 'done' | 'stopped' | 'failed'; result: string }
  | { kind: 'paused'; pending: PendingCall[] };

/** Who runs the conversation's sub-agents: on the slot its turn lends, or on one of their own. */
export interface SubagentRunner {
  /** Says a sub-agent that is about to run, or waits for the slot: `agent-start`, and its wait. */
  announce(call: ModelCall, waits: boolean): void;
  /** Runs it to its end, or to its pause; its events said under its `agentId`, then `agent-end`. */
  run(call: ModelCall, slot: CallsSlot | undefined, waited: boolean): Promise<SubagentEnd>;
  /** Its `agentId`, for the pause that keeps its call aside. */
  idOf(call: ModelCall): string;
  /**
   * The slots another sub-agent of the step may take now, without waiting (task 8.3): none with one slot, or
   * when every other slot works or is waited for.
   */
  free(): number;
}

export interface CallScope {
  conversationId: string;
  mode: PlayMode;
  projectId?: string;
  registry: ToolSet;
  permissions: PermissionEngine;
  place: Place;
  /** The engine's context: what a tool's output is cut to. */
  nCtx: number;
  signal: AbortSignal;
  /** The window's own tools (the client's): run there, the round paused for them. */
  windowTools?: ReadonlyMap<string, ToolDef>;
  /** Before and after a tool writes a file: its original kept for the turn (checkpoints). */
  beforeWrite?: ToolContext['beforeWrite'];
  afterWrite?: ToolContext['afterWrite'];
  onOutput?: ToolContext['onOutput'];
  /**
   * Before the first call that changes something (a write, a command) is
   * judged: the conversation may move to its own branch — the folders it
   * works in from then on (task 6.7) — or say why it cannot.
   */
  beforeChange?: () => Promise<ChangePlace | undefined>;
  /** These are a sub-agent's calls: every event under its id, and the calls it waits on carry it. */
  agentId?: string;
  /** The conversation's sub-agents (none for a sub-agent's own calls: it launches none). */
  subagents?: SubagentRunner;
}

export type RoundAnswer =
  | { results: ToolResult[] }
  | { pending: PendingCall[]; results: ToolResult[]; subagents: SubagentHold[] };

export async function answerCalls(
  scope: CallScope,
  calls: readonly ModelCall[],
  emit: (event: StreamRunEvent) => void,
  slot?: CallsSlot,
): Promise<RoundAnswer> {
  const mine = scope.agentId ? { agentId: scope.agentId } : {};
  const say = (event: StreamRunEvent): void => emit({ ...event, ...mine } as StreamRunEvent);
  const results: ToolResult[] = [];
  const pending: PendingCall[] = [];
  const holds: SubagentHold[] = [];
  // The sub-agents of the step already said: their tool-start is out, and those after the first wait.
  const announced = new Map<string, boolean>();
  // The sub-agents run together with one before them (in parallel): answered already.
  const ran = new Set<string>();
  for (const [index, call] of calls.entries()) {
    if (ran.has(call.id)) continue;
    if (pending.length > 0) {
      // A call before it waits for someone: this one waits behind it.
      if (!announced.has(call.id)) say({ type: 'tool-start', toolCallId: call.id, name: call.name, input: call.input, queued: true });
      pending.push({ toolCallId: call.id, name: call.name, input: call.input, reason: 'queued', ...mine });
      continue;
    }
    const launch = call.name === RUN_SUBAGENT && scope.subagents !== undefined && scope.agentId === undefined;
    if (!announced.has(call.id)) say({ type: 'tool-start', toolCallId: call.id, name: call.name, input: call.input });
    if (scope.signal.aborted) {
      // The person stopped the turn: what the model wrote before is answered, never run.
      say({ type: 'tool-aborted', toolCallId: call.id, cause: 'stopped' });
      results.push({ toolCallId: call.id, name: call.name, content: NOT_RUN_STOPPED, failed: true });
      continue;
    }
    if (launch) {
      const runner = scope.subagents!;
      /** A sub-agent's end: the result of its run_subagent call, or the calls it waits on the person for. */
      const settle = (member: ModelCall, end: SubagentEnd): void => {
        if (end.kind === 'paused') {
          pending.push(...end.pending);
          holds.push({ toolCallId: member.id, agentId: runner.idOf(member), name: member.name, input: member.input });
          return;
        }
        const content = capToolOutput(end.result, scope.nCtx);
        if (end.kind === 'done') say({ type: 'tool-resolved', toolCallId: member.id, result: content });
        else if (end.kind === 'stopped') say({ type: 'tool-aborted', toolCallId: member.id, cause: 'stopped' });
        else say({ type: 'tool-failed', toolCallId: member.id, error: content });
        results.push({ toolCallId: member.id, name: member.name, content, ...(end.kind === 'done' ? {} : { failed: true }) });
      };
      const free = announced.has(call.id) ? 0 : runner.free();
      if (free > 0) {
        // In parallel (task 8.3): this sub-agent and those right after it work together — as many on slots of
        // their own as are free now, the others one after another on the slot the turn lends (they wait for it,
        // and say so). A turn never waits for a slot while it holds one: two conversations doing that at once
        // would wait for each other for ever (review of phase 8).
        const group = [call];
        for (const later of calls.slice(index + 1)) {
          if (later.name !== RUN_SUBAGENT) break;
          group.push(later);
        }
        const own = new Set(group.slice(1, 1 + free).map((member) => member.id));
        for (const [at, member] of group.entries()) {
          if (at > 0) say({ type: 'tool-start', toolCallId: member.id, name: member.name, input: member.input });
          const waits = at > 0 && !own.has(member.id);
          announced.set(member.id, waits);
          runner.announce(member, waits);
        }
        const onLent = (async () => {
          const ends: (readonly [string, SubagentEnd])[] = [];
          for (const member of group.filter((one) => !own.has(one.id))) {
            ends.push([member.id, await runner.run(member, slot, announced.get(member.id) === true)] as const);
          }
          return ends;
        })();
        const onOwn = group.filter((one) => own.has(one.id)).map(async (member) => [member.id, await runner.run(member, undefined, false)] as const);
        const ends = new Map([...(await onLent), ...(await Promise.all(onOwn))]);
        for (const member of group) {
          ran.add(member.id);
          settle(member, ends.get(member.id)!);
        }
        continue;
      }
      if (!announced.has(call.id)) {
        // This sub-agent and those after it in the step: said now, the others waiting for the slot.
        announced.set(call.id, false);
        runner.announce(call, false);
        for (const later of calls.slice(index + 1)) {
          if (later.name !== RUN_SUBAGENT || announced.has(later.id)) continue;
          announced.set(later.id, true);
          say({ type: 'tool-start', toolCallId: later.id, name: later.name, input: later.input });
          runner.announce(later, true);
        }
      }
      settle(call, await runner.run(call, slot, announced.get(call.id) === true));
      continue;
    }
    if (scope.windowTools?.has(call.name)) {
      pending.push({ toolCallId: call.id, name: call.name, input: call.input, reason: 'external', ...mine });
      continue;
    }
    const tool = scope.registry.get(call.name);
    if (tool) {
      const judge = () =>
        scope.permissions.evaluate({
          tool: tool.def,
          input: call.input,
          mode: scope.mode,
          ...(scope.projectId !== undefined ? { projectId: scope.projectId } : {}),
          roots: scope.place.roots,
          ...(scope.place.barred ? { barred: scope.place.barred } : {}),
          ...(scope.agentId ? { agentId: scope.agentId } : {}),
        });
      let verdict = judge();
      // A change the mode lets through or asks: its branch first, so what is judged, shown and done is there.
      if (verdict.verdict !== 'deny' && (tool.def.effect === 'write' || tool.def.effect === 'execute') && scope.beforeChange) {
        const moved = await scope.beforeChange();
        if (moved && 'error' in moved) {
          say({ type: 'tool-failed', toolCallId: call.id, error: moved.error });
          results.push({ toolCallId: call.id, name: call.name, content: moved.error, failed: true });
          continue;
        }
        if (moved) {
          scope.place.roots = moved.roots;
          scope.place.barred = moved.barred;
          verdict = judge();
        }
      }
      if (verdict.verdict === 'deny') {
        const refusal = toolRefusal({ reason: verdict.reason, by: 'policy' });
        say({ type: 'tool-rejected', toolCallId: call.id, ...refusal });
        results.push({ toolCallId: call.id, name: call.name, content: refusal.reason, failed: true });
        continue;
      }
      if (verdict.verdict === 'ask') {
        say({ type: 'tool-awaiting-approval', toolCallId: call.id, name: call.name, input: call.input });
        pending.push({ toolCallId: call.id, name: call.name, input: call.input, reason: 'approval', ...mine });
        continue;
      }
    }
    const result = await scope.registry.run(
      { id: call.id, name: call.name, input: call.input },
      {
        conversationId: scope.conversationId,
        roots: scope.place.roots,
        nCtx: scope.nCtx,
        signal: scope.signal,
        ...(scope.beforeWrite ? { beforeWrite: scope.beforeWrite } : {}),
        ...(scope.afterWrite ? { afterWrite: scope.afterWrite } : {}),
        ...(scope.onOutput ? { onOutput: scope.onOutput } : {}),
      },
    );
    say(
      result.failed
        ? { type: 'tool-failed', toolCallId: call.id, error: result.content }
        : {
            type: 'tool-resolved',
            toolCallId: call.id,
            result: result.content,
            ...(result.structuredContent !== undefined ? { structuredResult: result.structuredContent } : {}),
          },
    );
    results.push(result);
  }
  return pending.length > 0 ? { pending, results, subagents: holds } : { results };
}
