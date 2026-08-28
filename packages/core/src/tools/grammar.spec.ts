import { describe, expect, it } from 'vitest';
import {
  buildGrammarConstraint,
  buildToolCallGrammar,
  escapeGbnfLiteral,
  GRAMMAR_TRIGGER_TYPE_WORD,
} from './grammar.js';
import type { ToolDef } from './types.js';

const tool = (name: string): ToolDef => ({
  name,
  description: `outil ${name}`,
  inputSchema: { type: 'object', properties: {} },
  effect: 'read',
});

describe('escapeGbnfLiteral', () => {
  it('escapes quotes and backslashes', () => {
    expect(escapeGbnfLiteral('a"b\\c')).toBe('a\\"b\\\\c');
  });

  it('leaves an ordinary name intact', () => {
    expect(escapeGbnfLiteral('read_file')).toBe('read_file');
  });
});

describe('buildToolCallGrammar', () => {
  it('bounds the name to the provided tools', () => {
    const grammar = buildToolCallGrammar([tool('read_file'), tool('run_shell')]);
    expect(grammar).toContain('"\\"read_file\\""');
    expect(grammar).toContain('"\\"run_shell\\""');
  });

  it('requires the closing tag in the root rule', () => {
    // Without it, the grammar would be satisfied before </tool_call> and
    // the call would come out truncated.
    expect(buildToolCallGrammar([tool('a')])).toContain('</tool_call>');
  });

  it('accepts the OPENING tag: the trigger feeds it to the grammar', () => {
    // Verified in src/llama-grammar.cpp (llama_grammar_accept_impl): when a
    // trigger fires, llama.cpp calls `llama_grammar_accept_token` with the
    // trigger's TEXT. The grammar must therefore be able to consume
    // `<tool_call>` as its first literal, otherwise the stack empties right
    // away and the server raises "Unexpected empty grammar stack after
    // accepting piece: <tool_call>". Observed for real on 2026-08-19 on
    // Paul's model, where `<tool_call>` is a single special token (id 248058).
    // The invariant: the very first literal the grammar can consume,
    // starting from the root, is the opening tag.
    const lines = buildToolCallGrammar([tool('a')]).split('\n');
    const root = lines.find((line) => line.startsWith('root ::='));
    expect(root).toMatch(/^root ::=\s*tool-call\b/);

    const call = lines.find((line) => line.startsWith('tool-call ::='));
    expect(call).toMatch(/^tool-call ::=\s*"<tool_call>"/);
  });

  it('allows several calls in a row (Hermes parallel calls)', () => {
    // The Hermes convention renders parallel calls as multiple blocks, and
    // our parser handles them. If the root only admitted one block, the
    // grammar would be satisfied after the first and the second would send
    // the stack back to empty — the model literally could not call two tools.
    const grammar = buildToolCallGrammar([tool('a')]);
    expect(grammar).toMatch(/^root ::=.*[*+]/m);
  });

  it('declares a root rule and the necessary JSON rules', () => {
    const grammar = buildToolCallGrammar([tool('a')]);
    expect(grammar).toMatch(/^root ::=/m);
    for (const rule of ['value', 'object', 'array', 'string', 'number', 'ws']) {
      expect(grammar).toMatch(new RegExp(`^${rule} ::=`, 'm'));
    }
  });

  it('emits no empty rule when only one tool is present', () => {
    const grammar = buildToolCallGrammar([tool('solo')]);
    expect(grammar).not.toMatch(/::=\s*$/m);
  });

  it('escapes an exotic tool name (the quote does not break the literal)', () => {
    const grammar = buildToolCallGrammar([tool('weird"name')]);
    expect(grammar).toContain('weird\\"name');
  });
});

describe('buildGrammarConstraint', () => {
  it('returns null with no tool (nothing to constrain)', () => {
    expect(buildGrammarConstraint([])).toBeNull();
  });

  it('triggers on <tool_call> in WORD mode', () => {
    const constraint = buildGrammarConstraint([tool('a')])!;
    expect(constraint.grammarLazy).toBe(true);
    expect(constraint.grammarTriggers).toEqual([
      { type: GRAMMAR_TRIGGER_TYPE_WORD, value: '<tool_call>' },
    ]);
  });

  it('preserves the special tags (otherwise the server refuses the trigger)', () => {
    const constraint = buildGrammarConstraint([tool('a')])!;
    expect(constraint.preservedTokens).toContain('<tool_call>');
    expect(constraint.preservedTokens).toContain('</tool_call>');
  });

  it('embeds the grammar of the provided tools', () => {
    const constraint = buildGrammarConstraint([tool('read_file')])!;
    expect(constraint.grammar).toContain('read_file');
  });
});
