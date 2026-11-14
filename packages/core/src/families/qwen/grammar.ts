/**
 * GBNF grammar for tool calls.
 *
 * It is LAZY: `grammar_lazy: true` + a trigger on `<tool_call>` (params
 * not documented in llama.cpp's README, verified in
 * `tools/server/server-schema.cpp`). The model therefore speaks freely,
 * and the constraint only applies from the moment it opens a call.
 *
 * What's constrained: the JSON envelope and especially the tool's NAME,
 * bound to the current inventory — a removed tool becomes literally
 * unemittable. The arguments remain free-form JSON, validated afterward
 * by the registry (an argument error is a normal loop turn, not a crash).
 */

import type { ToolDef } from '../../tools/types.js';
import type { GrammarConstraint } from '../types.js';
import { THINK_CLOSE, THINK_OPEN, TOOL_CALL_CLOSE, TOOL_CALL_OPEN } from './parser.js';

/** WORD type from `common_grammar_trigger_type` (common/common.h). */
export const GRAMMAR_TRIGGER_TYPE_WORD = 1;

export function escapeGbnfLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Standard JSON rules (ported from llama.cpp's grammars/json.gbnf). */
const JSON_RULES = [
  String.raw`value ::= object | array | string | number | ("true" | "false" | "null") ws`,
  String.raw`object ::= "{" ws ( string ":" ws value ("," ws string ":" ws value)* )? "}" ws`,
  String.raw`array ::= "[" ws ( value ("," ws value)* )? "]" ws`,
  String.raw`string ::= "\"" ( [^"\\\x7F\x00-\x1F] | "\\" (["\\bfnrt] | "u" [0-9a-fA-F]{4}) )* "\"" ws`,
  String.raw`number ::= ("-"? ([0-9] | [1-9] [0-9]*)) ("." [0-9]+)? ([eE] [-+]? [0-9]+)? ws`,
  String.raw`ws ::= | " " | "\n" [ \t]{0,20}`,
];

export function buildToolCallGrammar(tools: readonly ToolDef[]): string {
  const names = tools
    .map((t) => `"\\"${escapeGbnfLiteral(t.name)}\\""`)
    .join(' | ');

  return [
    // Several blocks in a row: the Hermes convention renders parallel
    // calls this way, and our parser reads them. A root with a single
    // block would be satisfied after the first, and the second would
    // find the stack empty.
    String.raw`root ::= tool-call (ws tool-call)*`,
    // BOTH tags are part of the root.
    // — The opening one because the lazy trigger feeds it to the grammar:
    //   `llama_grammar_accept_impl` (src/llama-grammar.cpp) calls
    //   `llama_grammar_accept_token` with the trigger's text. Without it,
    //   the server raises "Unexpected empty grammar stack after accepting
    //   piece: <tool_call>" on the very first tool call.
    // — The closing one because without it the grammar would be satisfied
    //   as soon as the JSON ends and the call would come out truncated.
    String.raw`tool-call ::= "<tool_call>" ws "{" ws "\"name\":" ws tool-name "," ws "\"arguments\":" ws object "}" ws "</tool_call>"`,
    `tool-name ::= ${names}`,
    ...JSON_RULES,
  ].join('\n');
}

export function buildGrammarConstraint(tools: readonly ToolDef[]): GrammarConstraint | null {
  if (tools.length === 0) return null;
  return {
    grammar: buildToolCallGrammar(tools),
    grammarLazy: true,
    grammarTriggers: [
      { type: GRAMMAR_TRIGGER_TYPE_WORD, value: TOOL_CALL_OPEN },
    ],
    preservedTokens: [TOOL_CALL_OPEN, TOOL_CALL_CLOSE, THINK_OPEN, THINK_CLOSE],
  };
}
