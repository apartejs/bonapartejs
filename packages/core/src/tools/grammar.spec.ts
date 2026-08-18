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
  it('échappe les guillemets et antislashs', () => {
    expect(escapeGbnfLiteral('a"b\\c')).toBe('a\\"b\\\\c');
  });

  it('laisse un nom ordinaire intact', () => {
    expect(escapeGbnfLiteral('read_file')).toBe('read_file');
  });
});

describe('buildToolCallGrammar', () => {
  it('borne le nom aux outils fournis', () => {
    const grammar = buildToolCallGrammar([tool('read_file'), tool('run_shell')]);
    expect(grammar).toContain('"\\"read_file\\""');
    expect(grammar).toContain('"\\"run_shell\\""');
  });

  it('exige la balise fermante dans la règle racine', () => {
    // Sans elle, la grammaire serait satisfaite avant </tool_call> et
    // l'appel serait tronqué.
    expect(buildToolCallGrammar([tool('a')])).toContain('</tool_call>');
  });

  it('déclare une règle racine et les règles JSON nécessaires', () => {
    const grammar = buildToolCallGrammar([tool('a')]);
    expect(grammar).toMatch(/^root ::=/m);
    for (const rule of ['value', 'object', 'array', 'string', 'number', 'ws']) {
      expect(grammar).toMatch(new RegExp(`^${rule} ::=`, 'm'));
    }
  });

  it('n’émet aucune règle vide quand un seul outil est présent', () => {
    const grammar = buildToolCallGrammar([tool('solo')]);
    expect(grammar).not.toMatch(/::=\s*$/m);
  });

  it('échappe un nom d’outil exotique (le guillemet ne casse pas le littéral)', () => {
    const grammar = buildToolCallGrammar([tool('weird"name')]);
    expect(grammar).toContain('weird\\"name');
  });
});

describe('buildGrammarConstraint', () => {
  it('retourne null sans outil (rien à contraindre)', () => {
    expect(buildGrammarConstraint([])).toBeNull();
  });

  it('déclenche sur <tool_call> en mode WORD', () => {
    const constraint = buildGrammarConstraint([tool('a')])!;
    expect(constraint.grammarLazy).toBe(true);
    expect(constraint.grammarTriggers).toEqual([
      { type: GRAMMAR_TRIGGER_TYPE_WORD, value: '<tool_call>' },
    ]);
  });

  it('préserve les balises spéciales (sinon le serveur refuse le déclencheur)', () => {
    const constraint = buildGrammarConstraint([tool('a')])!;
    expect(constraint.preservedTokens).toContain('<tool_call>');
    expect(constraint.preservedTokens).toContain('</tool_call>');
  });

  it('embarque la grammaire des outils fournis', () => {
    const constraint = buildGrammarConstraint([tool('read_file')])!;
    expect(constraint.grammar).toContain('read_file');
  });
});
