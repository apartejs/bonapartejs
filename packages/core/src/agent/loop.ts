/**
 * The agent's loop on the built-in engine. The conversation engine runs the
 * rounds in the slot; this answers each round's calls, one at a time, in the
 * order the model wrote them, with the one approval policy and the one
 * registry, and says it to the page in aparté's events:
 *
 * - allowed: `tool-start`, the registry runs it (writes and commands wait
 *   their turn there), then `tool-resolved` or `tool-failed`;
 * - refused by the policy: `tool-rejected { by: 'policy' }`, and the model
 *   reads aparté's refusal sentence as the call's result;
 * - to ask about: `tool-awaiting-approval`, and the turn pauses — the calls
 *   after it in the same step wait, `queued`; the calls before it keep their
 *   results;
 * - a tool of the window (`ask_user`): the turn pauses for the window;
 * - `run_subagent`: a sub-agent runs on the slot the turn lends it (task 8.1).
 *
 * Past `maxToolRounds` (25 by default) the turn stops: `turn-limit-exceeded`.
 * The calls themselves are answered by `answerCalls` (`calls.ts`).
 */

import type { PlayMode } from '@aparte/bonaparte-shared';
import type { StreamRunEvent } from '@aparte/engine';
import type { CallsAnswer, CallsSlot, ModelCall, TurnEvent, TurnInput, TurnResult } from '../conversation/engine.js';
import type { PendingCall } from '../journal/types.js';
import type { PermissionEngine } from '../permissions/engine.js';
import type { ToolSet } from '../tools/registry.js';
import type { ToolContext, ToolDef } from '../tools/types.js';
import { answerCalls, type CallScope, type ChangePlace } from './calls.js';
import { subagentRunner, type SubagentEngine } from './subagents.js';

export type { ChangePlace } from './calls.js';

export const DEFAULT_MAX_TOOL_ROUNDS = 25;

export interface AgentTurnContext {
  conversationId: string;
  /** The person's message, or a branch: what the turn answers. */
  input: Omit<TurnInput, 'tools'>;
  mode: PlayMode;
  projectId?: string;
  registry: ToolSet;
  permissions: PermissionEngine;
  /** The conversation engine: its turns, and its sub-agents' when it runs them (task 8.1). */
  conversations: { turn(id: string, input: TurnInput, sink: (event: TurnEvent) => void, signal?: AbortSignal): Promise<TurnResult> } & Partial<SubagentEngine>;
  /** The perimeter the tools run in. */
  roots: readonly string[];
  /** The engine's context: what a tool's output is cut to. */
  nCtx: number;
  /** The window's own tools (the client's): run there, the turn paused for them. */
  windowTools?: readonly ToolDef[];
  maxToolRounds?: number;
  /** What a paused turn is resumed with (signed, task 4.5). */
  ticket(pending: readonly PendingCall[]): string;
  signal: AbortSignal;
  /** Before and after a tool writes a file: its original kept for the turn (checkpoints). */
  beforeWrite?: ToolContext['beforeWrite'];
  afterWrite?: ToolContext['afterWrite'];
  onOutput?: ToolContext['onOutput'];
  /** Folders it never writes (on its own branch, its project's own checkout). */
  barred?: readonly string[];
  /**
   * Before the first call that changes something (a write, a command) is
   * judged: the conversation may move to its own branch — the folders it
   * works in from then on (task 6.7) — or say why it cannot.
   */
  beforeChange?: () => Promise<ChangePlace | undefined>;
}

/**
 * Runs the turn. `emit`: the tool events, for the page as they are;
 * `onTurnEvent`: what the conversation engine says (text, reasoning, steps).
 */
export async function runAgentTurn(
  ctx: AgentTurnContext,
  emit: (event: StreamRunEvent) => void,
  onTurnEvent: (event: TurnEvent) => void,
): Promise<TurnResult> {
  const maxRounds = ctx.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const windowTools = new Map((ctx.windowTools ?? []).map((tool) => [tool.name, tool]));
  const defs = [...ctx.registry.list(), ...windowTools.values()];
  const scope: CallScope = {
    conversationId: ctx.conversationId,
    mode: ctx.mode,
    ...(ctx.projectId !== undefined ? { projectId: ctx.projectId } : {}),
    registry: ctx.registry,
    permissions: ctx.permissions,
    // Moved when the conversation goes to its own branch — for its sub-agents too.
    place: { roots: ctx.roots, ...(ctx.barred ? { barred: ctx.barred } : {}) },
    nCtx: ctx.nCtx,
    signal: ctx.signal,
    windowTools,
    ...(ctx.beforeWrite ? { beforeWrite: ctx.beforeWrite } : {}),
    ...(ctx.afterWrite ? { afterWrite: ctx.afterWrite } : {}),
    ...(ctx.onOutput ? { onOutput: ctx.onOutput } : {}),
    ...(ctx.beforeChange ? { beforeChange: ctx.beforeChange } : {}),
  };
  const { subagentTurn, subagentPaused, recordSubagentAnswers } = ctx.conversations;
  if (subagentTurn && subagentPaused && recordSubagentAnswers) {
    const { windowTools: _window, ...inherited } = scope;
    scope.subagents = subagentRunner({
      ...inherited,
      engine: {
        subagentTurn: subagentTurn.bind(ctx.conversations),
        subagentPaused: subagentPaused.bind(ctx.conversations),
        recordSubagentAnswers: recordSubagentAnswers.bind(ctx.conversations),
        // Read each time: the engine may have relaunched with another number of slots.
        get slotCount() {
          return ctx.conversations.slotCount ?? 1;
        },
        get freeSlots() {
          return ctx.conversations.freeSlots ?? 0;
        },
      },
      emit,
      ...(ctx.maxToolRounds !== undefined ? { maxToolRounds: ctx.maxToolRounds } : {}),
    });
  }
  let rounds = 0;

  const onCalls = async (calls: readonly ModelCall[], slot?: CallsSlot): Promise<CallsAnswer> => {
    rounds += 1;
    if (rounds > maxRounds) {
      emit({ type: 'turn-limit-exceeded', scope: 'global', limit: maxRounds });
      return { stop: 'limit' };
    }
    const answer = await answerCalls(scope, calls, emit, slot);
    if (!('pending' in answer)) return { results: answer.results };
    return {
      suspend: {
        pending: answer.pending,
        ticket: ctx.ticket(answer.pending),
        results: answer.results,
        ...(answer.subagents.length > 0 ? { subagents: answer.subagents } : {}),
      },
    };
  };

  return ctx.conversations.turn(ctx.conversationId, { ...ctx.input, tools: { defs, onCalls } }, onTurnEvent, ctx.signal);
}
