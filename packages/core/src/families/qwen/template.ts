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

export function renderSystem(text: string): string {
  return `${IM_START}system\n${text}${IM_END}\n`;
}

export function renderUser(text: string): string {
  return `${IM_START}user\n${text}${IM_END}\n`;
}

export const ASSISTANT_HEADER = `${IM_START}assistant\n`;
export const EMPTY_THINK = '<think>\n\n</think>\n\n';

/**
 * A question asked beside the conversation — never frozen into it: a user
 * turn and an assistant header with reasoning off, to append to a frozen
 * history for one completion (a compaction's summary).
 */
export function renderSideTurn(text: string): string {
  return renderUser(text) + ASSISTANT_HEADER + EMPTY_THINK;
}
