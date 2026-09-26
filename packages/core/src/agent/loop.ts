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
import { neutralizeControlTokens } from '../wire/control-tokens.js';

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
  /** Whether the model may reason before answering. Default: on. */
  thinking?: boolean;
}

export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; content: string }
  | {
      type: 'turn_end';
      promptMs: number;
      cachedTokens: number;
      /** Prompt tokens of the last completion of the turn. */
      promptTokens: number;
      predictedTokens: number;
      /** What the slot holds after the turn — prompt and reply. */
      contextTokens: number;
      /** The last completion of the turn was cut at the context ceiling. */
      truncated: boolean;
    }
  /**
   * The message cannot fit — with room for a reply — in the server's
   * context (D-22): nothing was sent, or the server refused the prompt.
   * Emitted by the conversation engine, never by the loop itself.
   */
  | {
      type: 'context_overflow';
      used: number;
      /** What the server can hold — 0 when unknown (remote). */
      nCtx: number;
      /** What this conversation may occupy: the server's size, or its own cap below it. */
      limit: number;
      needed: number;
    }
  | { type: 'error'; message: string }
  // ── transcript mutations: the caller persists them to replay identically.
  //    The UI ignores them.
  | { type: 'assistant_committed'; entry: TranscriptEntry }
  | { type: 'results_committed'; entry: TranscriptEntry };

const DEFAULT_MAX_TURNS = 10;

/** An answer, or `false` as soon as the signal aborts — whichever comes first. */
function raceAbort(answer: Promise<boolean>, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const onAbort = (): void => resolve(false);
    signal.addEventListener('abort', onAbort, { once: true });
    answer.then(
      (granted) => {
        signal.removeEventListener('abort', onAbort);
        resolve(granted);
      },
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve(false);
      },
    );
  });
}

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
      let promptTokens = 0;
      let predictedTokens = 0;
      let contextTokens = 0;
      let truncated = false;
      let raw: string | undefined;

      try {
        for await (const event of this.options.backend.runTurn({
          conversationId: this.options.conversationId,
          system: this.options.system,
          tools: this.options.registry.list(),
          transcript,
          signal,
          ...(this.options.idSlot !== undefined ? { idSlot: this.options.idSlot } : {}),
          ...(this.options.sampling ? { sampling: this.options.sampling } : {}),
          ...(this.options.thinking !== undefined ? { thinking: this.options.thinking } : {}),
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
              promptTokens = event.stats.progress?.total ?? 0;
              predictedTokens = event.stats.predictedTokens;
              contextTokens = event.stats.contextTokens ?? 0;
              truncated = event.stats.truncated ?? false;
              raw = event.raw;
              break;
          }
        }
      } catch (error) {
        // A cancelled stream is not a failure: what arrived is what the
        // model wrote, and what the server's KV cache holds. It is committed
        // as the turn, so the next prompt stays a prefix of that cache.
        if (!signal.aborted) throw error;
      }

      const entry: TranscriptEntry = {
        role: 'assistant',
        text,
        ...(thinking ? { thinking } : {}),
        // Recorded so that a replay renders the same generation suffix as
        // the live turn, whether or not the model actually reasoned.
        reasoning: this.options.thinking ?? true,
        ...(calls.length > 0 ? { calls } : {}),
        ...(raw !== undefined ? { raw } : {}),
      };
      transcript.push(entry);
      yield { type: 'assistant_committed', entry };

      // Nothing to dispatch — or a cancelled turn, whose calls (if any were
      // parsed before the cut) must not run.
      if (calls.length === 0 || signal.aborted) {
        yield {
          type: 'turn_end',
          promptMs,
          cachedTokens,
          promptTokens,
          predictedTokens,
          contextTokens,
          truncated,
        };
        return;
      }

      const results: ToolOutcome[] = [];
      for (const call of calls) {
        yield { type: 'tool_call', name: call.name, args: call.arguments };
        // What a tool returns cannot speak as a role: neutralised here,
        // before the log, the prompt and the screen see it.
        const raw = await this.dispatch(call, signal);
        const outcome = { ...raw, content: neutralizeControlTokens(raw.content) };
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
        yield {
          type: 'turn_end',
          promptMs,
          cachedTokens,
          promptTokens,
          predictedTokens,
          contextTokens,
          truncated,
        };
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
      // The question may never be answered — a Stop, a deleted
      // conversation, a shutdown. An abort counts as a refusal, so the turn
      // ends instead of hanging on a panel nobody will click.
      const granted = await raceAbort(
        approve({
          id: `approval-${this.approvalSeq++}`,
          tool: name,
          args,
          ...(command !== undefined ? { command } : {}),
        }),
        signal,
      );
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
