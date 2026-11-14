/**
 * The GBNF grammar of a Gemma 4 tool call, after llama.cpp's own
 * (common/parsers/gemma4.cpp). It is LAZY: the model speaks freely until it
 * writes `<|tool_call>`, the trigger, whose text the grammar receives — so
 * the root consumes the tag itself. Constrained: the envelope, the name
 * (bound to the inventory: a removed tool cannot be called) and Gemma's
 * notation for the arguments. Their schema is checked by the registry.
 *
 * One simplification: a string may not contain `<|`, the start of the token
 * that closes it.
 */

import type { ToolDef } from '../../tools/types.js';
import { escapeGbnfLiteral, GRAMMAR_TRIGGER_TYPE_WORD } from '../qwen/grammar.js';
import type { GrammarConstraint } from '../types.js';
import { CHANNEL_CLOSE, CHANNEL_OPEN, TOOL_CALL_CLOSE, TOOL_CALL_OPEN, TURN_OPEN } from './template.js';

export function buildGemmaToolCallGrammar(tools: readonly ToolDef[]): string {
  const names = tools.map((tool) => `"${escapeGbnfLiteral(tool.name)}"`).join(' | ');
  return [
    String.raw`root ::= tool-call (ws tool-call)*`,
    String.raw`tool-call ::= "<|tool_call>call:" tool-name dict "<tool_call|>"`,
    `tool-name ::= ${names}`,
    String.raw`dict ::= "{" ws ( "}" | kv ( "," ws kv )* ws "}" )`,
    String.raw`kv ::= key ":" ws value`,
    String.raw`key ::= [^:}<]+`,
    String.raw`value ::= string | dict | array | number | "true" | "false" | "null"`,
    String.raw`array ::= "[" ws ( "]" | value ( "," ws value )* ws "]" )`,
    String.raw`string ::= "<|\"|>" string-char* "<|\"|>"`,
    String.raw`string-char ::= [^<] | "<" [^|]`,
    String.raw`number ::= "-"? ([0-9] | [1-9] [0-9]*) ("." [0-9]+)? ([eE] [-+]? [0-9]+)?`,
    String.raw`ws ::= | " " | "\n" [ \t]{0,20}`,
  ].join('\n');
}

export function buildGemmaGrammarConstraint(tools: readonly ToolDef[]): GrammarConstraint | null {
  if (tools.length === 0) return null;
  return {
    grammar: buildGemmaToolCallGrammar(tools),
    grammarLazy: true,
    grammarTriggers: [{ type: GRAMMAR_TRIGGER_TYPE_WORD, value: TOOL_CALL_OPEN }],
    // As llama.cpp preserves them for this format.
    preservedTokens: [CHANNEL_OPEN, CHANNEL_CLOSE, TOOL_CALL_OPEN, TOOL_CALL_CLOSE, TURN_OPEN],
  };
}
