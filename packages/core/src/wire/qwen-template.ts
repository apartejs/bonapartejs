/**
 * Client-side Qwen3 templating — THE module that makes the kv-store useful.
 *
 * The official Jinja template is not byte-stable from one turn to the
 * next (issue QwenLM/Qwen3#1826): re-templating the history breaks the
 * prefix cache. Here, turn N+1's prompt EXTENDS by construction turn N's:
 * the frozen history is never re-rendered, the emitted <think> blocks
 * stay verbatim, and the thinking/no-thinking choice only affects the
 * current turn's generation suffix.
 *
 * No application-level BOS: /completion inserts it itself depending on
 * the model (the double-BOS trap already met on monaparte).
 */

export const IM_START = '<|im_start|>';
export const IM_END = '<|im_end|>';

export interface AssistantTurnOptions {
  /** true: the model may emit <think>…; false: an empty think block is forced. */
  thinking: boolean;
}

export function renderSystem(text: string): string {
  return `${IM_START}system\n${text}${IM_END}\n`;
}

export function renderUser(text: string): string {
  return `${IM_START}user\n${text}${IM_END}\n`;
}

const ASSISTANT_HEADER = `${IM_START}assistant\n`;
const EMPTY_THINK = '<think>\n\n</think>\n\n';

/**
 * Append-only accumulator for a conversation's prompt.
 * Cycle: appendUser() → beginAssistantTurn() → (the server generates `raw`)
 * → completeAssistantTurn(raw) → appendUser() → …
 *
 * Guaranteed by construction: the prompt returned by beginAssistantTurn on
 * turn N+1 extends byte-for-byte turn N's followed by the generation —
 * the history is NEVER re-rendered.
 */
export class PromptLog {
  private history: string;
  /** Prompt sent to the server for the current assistant turn, otherwise null. */
  private pendingPrompt: string | null = null;

  constructor(systemPrompt: string) {
    this.history = renderSystem(systemPrompt);
  }

  /** Frozen history (stable prefix for the cache). */
  get frozen(): string {
    return this.history;
  }

  appendUser(text: string): void {
    if (this.pendingPrompt !== null) {
      throw new Error(
        'appendUser is not possible: an assistant turn is in progress (completeAssistantTurn expected).',
      );
    }
    this.history += renderUser(text);
  }

  /** Returns the COMPLETE prompt to send to /completion for this turn. */
  beginAssistantTurn(options: AssistantTurnOptions): string {
    if (this.pendingPrompt !== null) {
      throw new Error(
        'beginAssistantTurn is not possible: an assistant turn is already in progress.',
      );
    }
    const suffix = options.thinking
      ? ASSISTANT_HEADER
      : ASSISTANT_HEADER + EMPTY_THINK;
    this.pendingPrompt = this.history + suffix;
    return this.pendingPrompt;
  }

  /** Freezes the turn: `raw` is the model's raw output, verbatim. */
  completeAssistantTurn(raw: string): void {
    if (this.pendingPrompt === null) {
      throw new Error(
        'completeAssistantTurn is not possible: no assistant turn in progress.',
      );
    }
    // The history becomes exactly what the server saw + generated:
    // the turn's prompt (suffix included) + verbatim output + terminator.
    this.history = this.pendingPrompt + raw + `${IM_END}\n`;
    this.pendingPrompt = null;
  }
}
