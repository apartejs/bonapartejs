/**
 * Grammaire GBNF des appels d'outils.
 *
 * Elle est PARESSEUSE : `grammar_lazy: true` + un déclencheur sur
 * `<tool_call>` (params non documentés dans le README de llama.cpp, vérifiés
 * dans `tools/server/server-schema.cpp`). Le modèle parle donc librement, et
 * la contrainte ne s'applique qu'à partir du moment où il ouvre un appel.
 *
 * Ce qui est contraint : l'enveloppe JSON et surtout le NOM de l'outil, borné
 * à l'inventaire courant — un outil retiré devient littéralement inémettable.
 * Les arguments restent du JSON libre, validés ensuite par le registre (une
 * erreur d'arguments est un tour de boucle normal, pas un plantage).
 */

import {
  THINK_CLOSE,
  THINK_OPEN,
  TOOL_CALL_CLOSE,
  TOOL_CALL_OPEN,
} from '../wire/hermes-parser.js';
import type { ToolDef } from './types.js';

/** Type WORD de `common_grammar_trigger_type` (common/common.h). */
export const GRAMMAR_TRIGGER_TYPE_WORD = 1;

export interface GrammarConstraint {
  grammar: string;
  grammarLazy: true;
  grammarTriggers: { type: number; value: string }[];
  /** Les mots déclencheurs mono-token DOIVENT être préservés (sinon erreur 400). */
  preservedTokens: string[];
}

export function escapeGbnfLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Règles JSON standard (portées de grammars/json.gbnf de llama.cpp). */
const JSON_RULES = [
  String.raw`value ::= object | array | string | number | ("true" | "false" | "null") ws`,
  String.raw`object ::= "{" ws ( string ":" ws value ("," ws string ":" ws value)* )? "}" ws`,
  String.raw`array ::= "[" ws ( value ("," ws value)* )? "]" ws`,
  String.raw`string ::= "\"" ( [^"\\\x7F\x00-\x1F] | "\\" (["\\bfnrt] | "u" [0-9a-fA-F]{4}) )* "\"" ws`,
  String.raw`number ::= ("-"? ([0-9] | [1-9] [0-9]*)) ("." [0-9]+)? ([eE] [-+]? [0-9]+)? ws`,
  String.raw`ws ::= | " " | "\n" [ \t]{0,20}`,
];

export function buildToolCallGrammar(tools: ToolDef[]): string {
  const names = tools
    .map((t) => `"\\"${escapeGbnfLiteral(t.name)}\\""`)
    .join(' | ');

  return [
    // Plusieurs blocs d'affilée : la convention Hermes rend les appels
    // parallèles ainsi, et notre parseur les lit. Une racine à un seul bloc
    // serait satisfaite après le premier, et le second reviderait la pile.
    String.raw`root ::= tool-call (ws tool-call)*`,
    // Les DEUX balises font partie de la racine.
    // — L'ouvrante parce que le déclencheur paresseux la donne à la grammaire :
    //   `llama_grammar_accept_impl` (src/llama-grammar.cpp) appelle
    //   `llama_grammar_accept_token` avec le texte du déclencheur. Sans elle,
    //   le serveur lève « Unexpected empty grammar stack after accepting
    //   piece: <tool_call> » dès le premier appel d'outil.
    // — La fermante parce que sans elle la grammaire serait satisfaite dès la
    //   fin du JSON et l'appel sortirait tronqué.
    String.raw`tool-call ::= "<tool_call>" ws "{" ws "\"name\":" ws tool-name "," ws "\"arguments\":" ws object "}" ws "</tool_call>"`,
    `tool-name ::= ${names}`,
    ...JSON_RULES,
  ].join('\n');
}

export function buildGrammarConstraint(
  tools: ToolDef[],
): GrammarConstraint | null {
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
