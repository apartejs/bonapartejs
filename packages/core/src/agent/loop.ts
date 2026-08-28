/**
 * Agentic loop — provider-AGNOSTIC.
 *
 * It only manipulates a semantic transcript and structured events: it knows
 * nothing about the raw prompt, the GBNF grammar, or the Hermes format. How a
 * conversation becomes a request is the backend's business — today a single
 * one, llama.cpp's append-only prompt. This boundary stays the same: it's
 * what keeps the loop testable without a server.
 *
 * It is not built on `runStreamAgent` (@aparte/engine): that engine owns the
 * message list and re-serializes it on every turn, which is incompatible
 * with a stable-prefix backend. See the friction journal.
 */

import type {
  Backend,
  SamplingParams,
  SystemSpec,
  ToolCall,
  ToolOutcome,
  TranscriptEntry,
} from '../backend/types.js';
import type { PermissionEngine } from '../permissions/engine.js';
import type { ToolRegistry } from '../tools/registry.js';

export interface ApprovalRequest {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** Full command for execution tools (UI preview). */
  command?: string;
}

export type ApprovalResolver = (request: ApprovalRequest) => Promise<boolean>;

export interface AgentLoopOptions {
  backend: Backend;
  registry: ToolRegistry;
  permissions: PermissionEngine;
  system: SystemSpec;
  conversationId: string;
  /** Max number of model↔tool round-trips for a message. @default 10 */
  maxTurns?: number;
  approve?: ApprovalResolver;
  idSlot?: number;
  /** Conversation sampling (temperature & co). */
  sampling?: SamplingParams;
}

export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; content: string }
  | { type: 'turn_end'; promptMs: number; cachedTokens: number }
  | { type: 'error'; message: string }
  // ── transcript mutations: the caller persists them to replay identically.
  //    The UI ignores them.
  | { type: 'assistant_committed'; entry: TranscriptEntry }
  | { type: 'results_committed'; entry: TranscriptEntry };

const DEFAULT_MAX_TURNS = 10;

export class AgentLoop {
  private approvalSeq = 0;

  constructor(private readonly options: AgentLoopOptions) {}

  /**
   * Runs a message through. `transcript` is mutated append-only: it's the
   * source of truth shared with persistence.
   */
  async *run(
    transcript: TranscriptEntry[],
    userText: string,
    signal: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    const maxTurns = this.options.maxTurns ?? DEFAULT_MAX_TURNS;
    transcript.push({ role: 'user', text: userText });

    for (let turn = 0; turn < maxTurns; turn++) {
      let text = '';
      let thinking = '';
      const calls: ToolCall[] = [];
      let promptMs = 0;
      let cachedTokens = 0;
      let raw: string | undefined;

      for await (const event of this.options.backend.runTurn({
        conversationId: this.options.conversationId,
        system: this.options.system,
        tools: this.options.registry.list(),
        transcript,
        signal,
        ...(this.options.idSlot !== undefined ? { idSlot: this.options.idSlot } : {}),
        ...(this.options.sampling ? { sampling: this.options.sampling } : {}),
      })) {
        switch (event.type) {
          case 'text':
            text += event.delta;
            yield { type: 'token', text: event.delta };
            break;
          case 'thinking':
            thinking += event.delta;
            yield { type: 'thinking', text: event.delta };
            break;
          case 'tool_use':
            calls.push(event.call);
            break;
          case 'done':
            promptMs = event.stats.promptMs;
            cachedTokens = event.stats.progress?.cache ?? 0;
            raw = event.raw;
            break;
        }
      }

      const entry: TranscriptEntry = {
        role: 'assistant',
        text,
        ...(thinking ? { thinking } : {}),
        ...(calls.length > 0 ? { calls } : {}),
        ...(raw !== undefined ? { raw } : {}),
      };
      transcript.push(entry);
      yield { type: 'assistant_committed', entry };

      if (calls.length === 0) {
        yield { type: 'turn_end', promptMs, cachedTokens };
        return;
      }

      const results: ToolOutcome[] = [];
      for (const call of calls) {
        yield { type: 'tool_call', name: call.name, args: call.arguments };
        const outcome = await this.dispatch(call, signal);
        results.push(outcome);
        yield {
          type: 'tool_result',
          name: outcome.name,
          ok: outcome.ok,
          content: outcome.content,
        };
      }

      const resultsEntry: TranscriptEntry = { role: 'tool_results', results };
      transcript.push(resultsEntry);
      yield { type: 'results_committed', entry: resultsEntry };

      if (signal.aborted) {
        yield { type: 'turn_end', promptMs, cachedTokens };
        return;
      }
    }

    yield {
      type: 'error',
      message: `Reached the limit of ${maxTurns} tool round-trips: loop stopped.`,
    };
  }

  private async dispatch(
    call: ToolCall,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    const { name, arguments: args } = call;
    const registered = this.options.registry.get(name);
    if (!registered) {
      const available = this.options.registry.list().map((d) => d.name);
      return {
        name,
        ok: false,
        content:
          `Unknown tool: ${name}. Available tools: ` +
          `${available.join(', ') || 'none'}.`,
      };
    }

    const command =
      typeof args['command'] === 'string' ? (args['command'] as string) : undefined;
    const decision = this.options.permissions.evaluate({
      tool: name,
      effect: registered.def.effect,
      ...(command !== undefined ? { command } : {}),
    });

    if (decision === 'deny') {
      return {
        name,
        ok: false,
        content:
          `Denied by the current play mode (${this.options.permissions.getMode()}): ` +
          `${name} (${registered.def.effect}). Propose a read-only alternative.`,
      };
    }

    if (decision === 'ask') {
      const approve = this.options.approve;
      if (!approve) {
        // Fail-safe: with no one to grant approval, we don't act.
        return {
          name,
          ok: false,
          content: `Not authorized: ${name} requires approval, which is unavailable here.`,
        };
      }
      const granted = await approve({
        id: `approval-${this.approvalSeq++}`,
        tool: name,
        args,
        ...(command !== undefined ? { command } : {}),
      });
      if (!granted) {
        return {
          name,
          ok: false,
          content: `The user declined this action: ${name}.`,
        };
      }
    }

    // No "no project, no tool" guardrail: the project is the tools'
    // SCOPE, not their condition of existence. With no root, they work
    // unconfined — it's the play mode that arbitrates, not the absence of
    // a folder.
    const roots = this.options.system.roots ?? [];

    try {
      const result = await registered.handler(args, { roots, signal });
      return { name, ok: result.ok, content: result.content };
    } catch (error) {
      return {
        name,
        ok: false,
        content: `Tool ${name} threw: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
