/**
 * The Gemma family (Gemma 4): `<|turn>role … <turn|>` turns, reasoning in a
 * thought channel switched on in the system turn, tools declared in the
 * system turn in Gemma's own notation, calls written `<|tool_call>call:…`,
 * and a tool round trip that stays inside the model's turn. Checked, byte for
 * byte, against Google's chat template (see `__fixtures__/gemma.jinja`).
 *
 * As with Qwen, the model's raw output is frozen as it was written,
 * reasoning included: re-rendering the history without it would change the
 * prefix the KV cache serves. Google suggests stripping the thoughts of
 * earlier turns; we keep them, and pay it in context.
 */

import type { ToolDef, ToolResult } from '../../tools/types.js';
import { neutralizeControlTokens } from '../control-tokens.js';
import type { FamilyLayer } from '../types.js';
import { formatArgument, formatFunctionDeclaration } from './declarations.js';
import { GemmaStreamDemux } from './demux.js';
import { buildGemmaGrammarConstraint } from './grammar.js';
import {
  CHANNEL_CLOSE,
  CHANNEL_OPEN,
  EMPTY_THOUGHT,
  MODEL_HEADER,
  QUOTE,
  renderSystem,
  renderUser,
  THINK,
  TOOL_CALL_CLOSE,
  TOOL_CALL_OPEN,
  TOOL_CLOSE,
  TOOL_OPEN,
  TOOL_RESPONSE_CLOSE,
  TOOL_RESPONSE_OPEN,
  TURN_CLOSE,
  TURN_OPEN,
} from './template.js';

const CONTROL_TOKENS = [
  TURN_OPEN,
  TURN_CLOSE,
  THINK,
  CHANNEL_OPEN,
  CHANNEL_CLOSE,
  TOOL_OPEN,
  TOOL_CLOSE,
  TOOL_CALL_OPEN,
  TOOL_CALL_CLOSE,
  TOOL_RESPONSE_OPEN,
  TOOL_RESPONSE_CLOSE,
  QUOTE,
  '<bos>',
  '<eos>',
  '<start_of_turn>',
  '<end_of_turn>',
] as const;

const disarm = (text: string): string => neutralizeControlTokens(text, { controlTokens: CONTROL_TOKENS });

/** A schema from elsewhere (an MCP server writes its own): every key and string disarmed. */
function disarmed(value: unknown): unknown {
  if (typeof value === 'string') return disarm(value);
  if (Array.isArray(value)) return value.map(disarmed);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [disarm(key), disarmed(item)]));
  }
  return value;
}

function renderToolResult(result: ToolResult): string {
  const field = result.failed ? 'error' : 'value';
  return `${TOOL_RESPONSE_OPEN}response:${result.name}{${field}:${QUOTE}${disarm(result.content)}${QUOTE}}${TOOL_RESPONSE_CLOSE}`;
}

function renderDeclaration(tool: ToolDef): string {
  const safe = {
    name: tool.name,
    description: disarm(tool.description),
    inputSchema: disarmed(tool.inputSchema) as ToolDef['inputSchema'],
  };
  return `${TOOL_OPEN}${formatFunctionDeclaration(safe)}${TOOL_CLOSE}`;
}

export const gemmaLayer: FamilyLayer = {
  id: 'gemma',
  controlTokens: CONTROL_TOKENS,
  // `<|tool_response>`: after a call the model hands over, and we answer.
  stop: [TURN_CLOSE, TOOL_RESPONSE_OPEN],

  renderSystem,
  renderSystemNote: (text) => `${TURN_OPEN}system
${disarm(text).trim()}${TURN_CLOSE}
`,
  renderUser: (text) => renderUser(disarm(text)),
  renderToolResults: (results) => results.map(renderToolResult).join(''),
  beginAssistant: ({ thinking, continuing }) => (continuing ? '' : thinking ? MODEL_HEADER : MODEL_HEADER + EMPTY_THOUGHT),
  // An answer that ended on a call leaves its turn open: its responses follow.
  endAssistant: (raw) => (raw.trimEnd().endsWith(TOOL_CALL_CLOSE) ? '' : `${TURN_CLOSE}\n`),
  // As the template renders a model's message of the history: no thought, the text trimmed, the calls in its
  // notation (keys sorted, unquoted), the turn left open for their responses.
  renderAnswer: ({ text, calls, continuing }) =>
    (continuing ? '' : MODEL_HEADER) +
    disarm(text).trim() +
    calls
      .map((call) => `${TOOL_CALL_OPEN}call:${disarm(call.name)}${formatArgument(disarmed(call.input), false)}${TOOL_CALL_CLOSE}`)
      .join('') +
    (calls.length > 0 ? '' : `${TURN_CLOSE}\n`),

  // The declarations are the convention: Gemma was taught them.
  renderToolConvention: () => '',
  renderToolInventory: (tools) => tools.map(renderDeclaration).join(''),
  toolGrammar: (tools) => buildGemmaGrammarConstraint(tools),
  createDemux: () => new GemmaStreamDemux(),
};
