/**
 * The Qwen family: ChatML turns (`<|im_start|>role … <|im_end|>`), reasoning
 * in `<think>`, tool calls in the Hermes convention (`<tool_call>{json}`),
 * constrained by a lazy grammar. It assembles the template, the parser and
 * the stream demultiplexer ported from v0, byte for byte: a conversation
 * renders exactly as it did there.
 */

import type { ToolDef, ToolResult } from '../../tools/types.js';
import { neutralizeControlTokens } from '../control-tokens.js';
import type { FamilyLayer } from '../types.js';
import { HermesStreamDemux } from './demux.js';
import { buildGrammarConstraint } from './grammar.js';
import { THINK_CLOSE, THINK_OPEN, TOOL_CALL_CLOSE, TOOL_CALL_OPEN } from './parser.js';
import { ASSISTANT_HEADER, EMPTY_THINK, IM_END, IM_START, renderSystem, renderUser } from './template.js';

const CONTROL_TOKENS = [
  IM_START,
  IM_END,
  '<|endoftext|>',
  TOOL_CALL_OPEN,
  TOOL_CALL_CLOSE,
  '<tool_response>',
  '</tool_response>',
  THINK_OPEN,
  THINK_CLOSE,
] as const;

const disarm = (text: string): string => neutralizeControlTokens(text, { controlTokens: CONTROL_TOKENS });

/** A tool's line. Its description and schema may come from elsewhere — an MCP server writes its own. */
function renderToolLine(tool: ToolDef): string {
  return disarm(`- ${tool.name}: ${tool.description}\n  arguments: ${JSON.stringify(tool.inputSchema)}`);
}

function renderToolResult(result: ToolResult): string {
  return `[tool result: ${result.name} — ${result.failed ? 'failed' : 'ok'}]\n${disarm(result.content)}`;
}

export const qwenLayer: FamilyLayer = {
  id: 'qwen',
  controlTokens: CONTROL_TOKENS,
  stop: [IM_END, '<|endoftext|>'],

  renderSystem,
  renderSystemNote: (text) => renderSystem(disarm(text)),
  renderUser: (text) => renderUser(disarm(text)),
  // The results answer the calls in a turn of the person, as in v0.
  renderToolResults: (results) => renderUser(results.map(renderToolResult).join('\n\n')),
  beginAssistant: ({ thinking }) => (thinking ? ASSISTANT_HEADER : ASSISTANT_HEADER + EMPTY_THINK),
  endAssistant: () => `${IM_END}\n`,
  // A turn of its own, even after tool results (they were a turn of the person); the calls as the system
  // prompt's convention writes them, their JSON disarmed whole.
  renderAnswer: ({ text, calls }) =>
    ASSISTANT_HEADER +
    disarm(text).trim() +
    calls
      .map((call) => `${TOOL_CALL_OPEN}${disarm(`{"name": ${JSON.stringify(call.name)}, "arguments": ${JSON.stringify(call.input)}}`)}${TOOL_CALL_CLOSE}`)
      .join('') +
    `${IM_END}\n`,

  renderToolConvention: () =>
    'To call a tool, emit exactly:\n' +
    '<tool_call>{"name": "tool_name", "arguments": {…}}</tool_call>\n' +
    'One call per block; emit several blocks for several calls. ' +
    'Results are returned to you on the next turn.',
  renderToolInventory: (tools) =>
    tools.length === 0 ? '\n\nNo tools available.' : `\n\nAvailable tools:\n${tools.map(renderToolLine).join('\n')}`,
  toolGrammar: (tools) => buildGrammarConstraint(tools),
  createDemux: () => new HermesStreamDemux(),
};
