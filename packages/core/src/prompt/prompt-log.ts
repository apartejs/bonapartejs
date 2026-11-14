/**
 * The prompt of a conversation, append-only.
 *
 * Cycle: appendSystem() → appendUser() → beginAssistantTurn() → (the server
 * generates `raw`) → completeAssistantTurn(raw) → appendUser() or
 * appendToolResults() → …
 *
 * Guaranteed by construction: the prompt returned by beginAssistantTurn on
 * turn N+1 extends turn N's byte for byte, followed by the generation — the
 * history is NEVER rendered again. That is what lets the KV cache of the slot
 * serve the whole prefix (Qwen's own chat template is not byte-stable across
 * turns: QwenLM/Qwen3#1826). The family layer says how each piece is written.
 *
 * No application-level BOS: /completion inserts it itself, depending on the
 * model.
 */

import type { FamilyLayer } from '../families/types.js';
import type { ToolResult } from '../tools/types.js';

export interface AssistantTurnOptions {
  /** true: the model may reason; false: an empty reasoning block is forced. */
  thinking: boolean;
}

export class PromptLog {
  private history: string;
  /** The prompt sent for the current assistant turn, otherwise null. */
  private pendingPrompt: string | null = null;

  /** `frozen`: the text a conversation froze earlier, to go on from (empty: a new one). */
  constructor(
    private readonly family: FamilyLayer,
    frozen = '',
  ) {
    this.history = frozen;
  }

  /** The frozen history: the stable prefix the cache serves. */
  get frozen(): string {
    return this.history;
  }

  appendSystem(text: string): void {
    this.closedTurn('appendSystem');
    this.history += this.family.renderSystem(text);
  }

  appendUser(text: string): void {
    this.closedTurn('appendUser');
    this.history += this.family.renderUser(text);
  }

  appendToolResults(results: readonly ToolResult[]): void {
    this.closedTurn('appendToolResults');
    this.history += this.family.renderToolResults(results);
  }

  /** Returns the COMPLETE prompt to send to /completion for this turn. */
  beginAssistantTurn(options: AssistantTurnOptions): string {
    this.closedTurn('beginAssistantTurn');
    this.pendingPrompt = this.history + this.family.beginAssistant(options);
    return this.pendingPrompt;
  }

  /** Freezes the turn: `raw` is the model's raw output, verbatim. */
  completeAssistantTurn(raw: string): void {
    if (this.pendingPrompt === null) {
      throw new Error('completeAssistantTurn is not possible: no assistant turn in progress.');
    }
    // The history becomes exactly what the server saw and generated.
    this.history = this.pendingPrompt + raw + this.family.endAssistant();
    this.pendingPrompt = null;
  }

  /** Drops the turn begun: the request failed, and nothing of it enters the history. */
  abandonAssistantTurn(): void {
    this.pendingPrompt = null;
  }

  /**
   * Back to an earlier state of the history — a PREFIX of it, never another
   * text: the server keeps the common prefix in its slot. Not a re-render.
   */
  rewind(prefix: string): void {
    if (!this.history.startsWith(prefix)) throw new Error('rewind: not a prefix of the history.');
    this.history = prefix;
    this.pendingPrompt = null;
  }

  private closedTurn(what: string): void {
    if (this.pendingPrompt !== null) {
      throw new Error(`${what} is not possible: an assistant turn is in progress.`);
    }
  }
}
