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
  /** For execution tools: allowed command prefix. */
  commandPrefix?: string;
}

export interface PermissionQuery {
  tool: string;
  effect: ToolEffect;
  /** Full command, for execution tools. */
  command?: string;
}

export class PermissionEngine {
  constructor(
    private mode: PlayMode = 'repetition',
    private rules: AllowRule[] = [],
  ) {}

  getMode(): PlayMode {
    return this.mode;
  }

  setMode(mode: PlayMode): void {
    this.mode = mode;
  }

  listRules(): AllowRule[] {
    return this.rules.map((rule) => ({ ...rule }));
  }

  remember(rule: AllowRule): void {
    if (!this.rules.some((existing) => sameRule(existing, rule))) {
      this.rules = [...this.rules, { ...rule }];
    }
  }

  forget(rule: AllowRule): void {
    this.rules = this.rules.filter((existing) => !sameRule(existing, rule));
  }

  evaluate(query: PermissionQuery): PermissionDecision {
    const ceiling = MODE_MATRIX[this.mode][query.effect];
    // The mode is a ceiling: a rule can only loosen an "ask".
    if (ceiling !== 'ask') return ceiling;
    return this.rules.some((rule) => matches(rule, query)) ? 'allow' : 'ask';
  }
}

const MODE_MATRIX: Record<PlayMode, Record<ToolEffect, PermissionDecision>> = {
  lecture: { read: 'allow', write: 'deny', execute: 'deny' },
  repetition: { read: 'allow', write: 'ask', execute: 'ask' },
  plume: { read: 'allow', write: 'allow', execute: 'ask' },
  impro: { read: 'allow', write: 'allow', execute: 'allow' },
};

function sameRule(a: AllowRule, b: AllowRule): boolean {
  return a.tool === b.tool && a.commandPrefix === b.commandPrefix;
}

function matches(rule: AllowRule, query: PermissionQuery): boolean {
  if (rule.tool !== query.tool) return false;
  if (rule.commandPrefix === undefined) return true;
  const command = query.command ?? '';
  if (!command.startsWith(rule.commandPrefix)) return false;
  // Word boundary: "pnpm test" must not authorize "pnpm testament".
  const next = command.charAt(rule.commandPrefix.length);
  return next === '' || /\s/.test(next);
}
