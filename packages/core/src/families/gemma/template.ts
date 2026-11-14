/**
 * Gemma 4's turns, as its official chat template writes them
 * (https://ai.google.dev/gemma/docs/core/prompt-formatting-gemma4):
 *
 *   <|turn>system\n<|think|>\n…<|tool>declaration:…<tool|><turn|>\n
 *   <|turn>user\n…<turn|>\n
 *   <|turn>model\n<|channel>thought\n…<channel|>…<turn|>\n
 *
 * A tool round trip stays inside the model's turn: the call, then the
 * response, then the rest of the answer, with no new turn in between.
 * No application-level BOS: /completion inserts it itself.
 */

export const TURN_OPEN = '<|turn>';
export const TURN_CLOSE = '<turn|>';
export const THINK = '<|think|>';
export const CHANNEL_OPEN = '<|channel>';
export const CHANNEL_CLOSE = '<channel|>';
export const TOOL_OPEN = '<|tool>';
export const TOOL_CLOSE = '<tool|>';
export const TOOL_CALL_OPEN = '<|tool_call>';
export const TOOL_CALL_CLOSE = '<tool_call|>';
export const TOOL_RESPONSE_OPEN = '<|tool_response>';
export const TOOL_RESPONSE_CLOSE = '<tool_response|>';
/** Gemma's string delimiter in structured blocks: a token of its own. */
export const QUOTE = '<|"|>';

/**
 * The system turn. Reasoning is switched on here, once, for the whole
 * conversation (`<|think|>`): the frozen prompt cannot change later. A turn
 * that should not reason gets the empty thought channel instead.
 */
export function renderSystem(text: string): string {
  return `${TURN_OPEN}system\n${THINK}\n${text.trim()}${TURN_CLOSE}\n`;
}

/** The template trims what the person wrote. */
export function renderUser(text: string): string {
  return `${TURN_OPEN}user\n${text.trim()}${TURN_CLOSE}\n`;
}

export const MODEL_HEADER = `${TURN_OPEN}model\n`;
/** What the template writes when reasoning is off: an empty thought channel. */
export const EMPTY_THOUGHT = `${CHANNEL_OPEN}thought\n${CHANNEL_CLOSE}`;
