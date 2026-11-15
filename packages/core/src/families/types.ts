/**
 * A family of models — Qwen, Gemma, Llama, Mistral, gpt-oss — is a way of
 * being spoken to: its turns and their tokens, its tool-call convention and
 * grammar, the shape of its output stream. The built-in engine renders the
 * prompt itself (on /completion, never the chat endpoint) through the layer
 * of the model's family.
 */

import type { ToolDef, ToolResult } from '../tools/types.js';

export type FamilyId = 'qwen' | 'gemma' | 'llama' | 'mistral' | 'gpt-oss';

/** What llama.cpp's /completion takes to constrain a tool call (server-schema.cpp). */
export interface GrammarConstraint {
  grammar: string;
  grammarLazy: true;
  grammarTriggers: { type: number; value: string }[];
  /** Single-token trigger words must be preserved (otherwise a 400). */
  preservedTokens: string[];
}

/** What the stream of an answer says, piece by piece. */
export type DemuxEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  /** A call, once it is whole. Its arguments are checked by the registry. */
  | { type: 'tool-call'; name: string; input: Record<string, unknown> }
  /** A call the model opened and that cannot be read: nothing of it is shown. */
  | { type: 'tool-call-malformed'; raw: string };

/** What an earlier answer said, read back from what its model wrote. */
export interface EarlierAnswer {
  text: string;
  calls: readonly { name: string; input: Record<string, unknown> }[];
  continuing?: boolean;
}

export interface StreamDemux {
  push(delta: string): DemuxEvent[];
  /** At the end of the generation: what was held back, and an unclosed call. */
  flush(): DemuxEvent[];
  /** The raw output, verbatim: what is frozen into the prompt. */
  readonly raw: string;
}

export interface FamilyLayer {
  readonly id: FamilyId;
  /** The tokens of the template that text from elsewhere must never form. */
  readonly controlTokens: readonly string[];
  /** What ends an answer. */
  readonly stop: readonly string[];
  renderSystem(text: string): string;
  /**
   * A system turn later in the conversation — a delta: what changed since the
   * system prompt was frozen. No reasoning switch; its text disarmed (a tool
   * description or a project file may have written it).
   */
  renderSystemNote(text: string): string;
  /** The person's turn; control tokens in it are disarmed. */
  renderUser(text: string): string;
  /** Tool results, as the turn that answers the calls; their content is disarmed. */
  renderToolResults(results: readonly ToolResult[]): string;
  /**
   * What opens the model's answer. `continuing`: the answer follows tool
   * results inside the same turn (Gemma) — Qwen opens a new turn anyway.
   */
  beginAssistant(options: { thinking: boolean; continuing?: boolean }): string;
  /** What closes what the model wrote: an answer that ended on a tool call may leave its turn open. */
  endAssistant(raw: string): string;
  /**
   * An answer of an earlier model, as this family's template renders history (task 7.4: a conversation that
   * changes model is rendered again): its text, then its calls in the family's syntax — no reasoning. Text and
   * arguments come from elsewhere, and are disarmed. `continuing`: it follows tool results in the same turn.
   * An answer with calls leaves its turn as the family's own does: their results follow.
   */
  renderAnswer(answer: EarlierAnswer): string;
  /** How to call a tool, said in the system prompt. Sent to the model: English. */
  renderToolConvention(): string;
  /**
   * The tools, as they follow the system text directly in the same turn —
   * where the family's template puts them (Gemma: its declarations close the
   * system turn). Sent to the model: English.
   */
  renderToolInventory(tools: readonly ToolDef[]): string;
  /** The lazy grammar of a call; null without tools. */
  toolGrammar(tools: readonly ToolDef[]): GrammarConstraint | null;
  createDemux(): StreamDemux;
}
