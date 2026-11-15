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
 * - a tool of the window (`ask_user`): the turn pauses for the window.
 *
 * Past `maxToolRounds` (25 by default) the turn stops: `turn-limit-exceeded`.
 */

import type { PlayMode } from '@aparte/bonaparte-shared';
import { toolRefusal, type StreamRunEvent } from '@aparte/engine';
import type { CallsAnswer, ModelCall, TurnEvent, TurnInput, TurnResult } from '../conversation/engine.js';
import type { PendingCall } from '../journal/types.js';
import type { PermissionEngine } from '../permissions/engine.js';
import type { ToolSet } from '../tools/registry.js';
import type { ToolContext, ToolDef, ToolResult } from '../tools/types.js';
import { NOT_RUN_STOPPED } from './resume.js';

export const DEFAULT_MAX_TOOL_ROUNDS = 25;

export interface AgentTurnContext {
  conversationId: string;
  /** The person's message, or a branch: what the turn answers. */
  input: Omit<TurnInput, 'tools'>;
  mode: PlayMode;
  projectId?: string;
  registry: ToolSet;
  permissions: PermissionEngine;
  conversations: { turn(id: string, input: TurnInput, sink: (event: TurnEvent) => void, signal?: AbortSignal): Promise<TurnResult> };
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
  /**
   * Before the first call that changes something (a write, a command): the
   * conversation may move to its own branch — the folders it works in from
   * then on (task 6.7).
   */
  beforeChange?: () => Promise<readonly string[] | undefined>;
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
  let rounds = 0;

  const onCalls = async (calls: readonly ModelCall[]): Promise<CallsAnswer> => {
    rounds += 1;
    if (rounds > maxRounds) {
      emit({ type: 'turn-limit-exceeded', scope: 'global', limit: maxRounds });
      return { stop: 'limit' };
    }
    const results: ToolResult[] = [];
    const pending: PendingCall[] = [];
    for (const call of calls) {
      if (pending.length > 0) {
        // A call before it waits for someone: this one waits behind it.
        emit({ type: 'tool-start', toolCallId: call.id, name: call.name, input: call.input, queued: true });
        pending.push({ toolCallId: call.id, name: call.name, input: call.input, reason: 'queued' });
        continue;
      }
      emit({ type: 'tool-start', toolCallId: call.id, name: call.name, input: call.input });
      if (ctx.signal.aborted) {
        // The person stopped the turn: what the model wrote before is answered, never run.
        emit({ type: 'tool-aborted', toolCallId: call.id, cause: 'stopped' });
        results.push({ toolCallId: call.id, name: call.name, content: NOT_RUN_STOPPED, failed: true });
        continue;
      }
      if (windowTools.has(call.name)) {
        pending.push({ toolCallId: call.id, name: call.name, input: call.input, reason: 'external' });
        continue;
      }
      const tool = ctx.registry.get(call.name);
      if (tool) {
        const verdict = ctx.permissions.evaluate({
          tool: tool.def,
          input: call.input,
          mode: ctx.mode,
          ...(ctx.projectId !== undefined ? { projectId: ctx.projectId } : {}),
        });
        if (verdict.verdict === 'deny') {
          const refusal = toolRefusal({ reason: verdict.reason, by: 'policy' });
          emit({ type: 'tool-rejected', toolCallId: call.id, ...refusal });
          results.push({ toolCallId: call.id, name: call.name, content: refusal.reason, failed: true });
          continue;
        }
        if (verdict.verdict === 'ask') {
          emit({ type: 'tool-awaiting-approval', toolCallId: call.id, name: call.name, input: call.input });
          pending.push({ toolCallId: call.id, name: call.name, input: call.input, reason: 'approval' });
          continue;
        }
      }
      if (tool && (tool.def.effect === 'write' || tool.def.effect === 'execute') && ctx.beforeChange) {
        const moved = await ctx.beforeChange();
        if (moved) ctx.roots = moved;
      }
      const result = await ctx.registry.run(
        { id: call.id, name: call.name, input: call.input },
        {
          conversationId: ctx.conversationId,
          roots: ctx.roots,
          nCtx: ctx.nCtx,
          signal: ctx.signal,
          ...(ctx.beforeWrite ? { beforeWrite: ctx.beforeWrite } : {}),
          ...(ctx.afterWrite ? { afterWrite: ctx.afterWrite } : {}),
          ...(ctx.onOutput ? { onOutput: ctx.onOutput } : {}),
        },
      );
      emit(
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
    if (pending.length > 0) return { suspend: { pending, ticket: ctx.ticket(pending), results } };
    return { results };
  };

  return ctx.conversations.turn(ctx.conversationId, { ...ctx.input, tools: { defs, onCalls } }, onTurnEvent, ctx.signal);
}
