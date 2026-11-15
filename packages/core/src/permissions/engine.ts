/**
 * The one approval policy, in the core: for a call, a mode, a project — allow,
 * ask (and why), or refuse (and why, in English, for the model).
 *
 * The matrix of the design document (§9) by effect, and what the modes do
 * not change:
 * - a file that runs later (`.git/hooks`, `package.json`, `*.config.*`,
 *   `.env`, a shell profile, bonaparte's own data, the project's « always
 *   asked ») asks in every mode — refused in Lecture like any write;
 * - a write outside the project asks, even in Impro; a network path is refused;
 * - going online asks in every mode while « ask before the network » is on;
 * - a tool that does not say what it does is taken as one that runs something;
 * - a rule remembered turns an ask of the mode (or of the network) into an
 *   allow — never a refusal, never a file that runs later, never a write
 *   outside the project.
 */

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { PlayMode, ToolEffect, Verdict } from '@aparte/bonaparte-shared';
import type { ToolDef } from '../tools/types.js';
import { InvalidPathError, NetworkPathError, permissionPath, resolveInPerimeter } from '../project/paths.js';
import { isValidRule, matchesRule, type AllowRule, type CommandLine } from './rules.js';

export interface PermissionQuery {
  tool: ToolDef;
  input: unknown;
  mode: PlayMode;
  projectId?: string;
  agentId?: string;
}

export interface PermissionEngineDeps {
  /** The folders of a project; [] without one (the perimeter is then the home folder). */
  roots(projectId: string | undefined): readonly string[];
  /** bonaparte's data folder: its settings, rules and servers are commands run later. */
  dataDir: string;
  /** The rules « always allow » remembered for a project. */
  rules?(projectId: string | undefined): readonly AllowRule[];
  /** « Ask before going online » (on by default). */
  askBeforeNetwork?(): boolean;
  /** What a project adds to the files always asked (« Dockerfile »). */
  alwaysAsk?(projectId: string | undefined): readonly string[];
  /** Tests only. */
  home?: string;
}

type Short = 'allow' | 'ask' | 'deny';
type KnownEffect = Exclude<ToolEffect, never>;

const MATRIX: Record<PlayMode, Record<KnownEffect, Short>> = {
  lecture: { read: 'allow', write: 'deny', execute: 'deny', network: 'ask', ui: 'allow' },
  repetition: { read: 'allow', write: 'ask', execute: 'ask', network: 'ask', ui: 'allow' },
  plume: { read: 'allow', write: 'allow', execute: 'ask', network: 'ask', ui: 'allow' },
  impro: { read: 'allow', write: 'allow', execute: 'allow', network: 'allow', ui: 'allow' },
};
const KNOWN = new Set<string>(['read', 'write', 'execute', 'network', 'ui']);

const ARMED: RegExp[] = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.husky\//,
  /(^|\/)\.vscode\//,
  /(^|\/)\.github\/workflows\//,
  /(^|\/)package\.json$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.yarnrc(\.yml)?$/,
  // Any `<name>.config.<ext>`: what a build tool loads and runs.
  /(^|\/)[^/]+\.config\.[a-z0-9]+$/,
  /(^|\/)makefile$/,
  /(^|\/)\.env(\.[^/]*)?$/,
  // Beyond a project, within the home folder: what the system runs at login,
  // what a shell runs when it starts, who may log in by key.
  /(^|\/)start menu\/programs\/startup\//,
  /(^|\/)(windows)?powershell\/[^/]*profile\.ps1$/,
  /(^|\/)\.(bashrc|bash_profile|bash_login|profile|zshrc|zprofile|zshenv|zlogin)$/,
  /(^|\/)\.config\/fish\/config\.fish$/,
  /(^|\/)\.config\/autostart\//,
  /(^|\/)library\/launchagents\//,
  /(^|\/)\.ssh\//,
  /(^|\/)\.gitconfig$/,
];

function normalize(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/** Does writing this file mean running something later? */
export function isArmedPath(path: string, dataDir: string, alwaysAsk: readonly string[] = []): boolean {
  const normalized = normalize(path);
  if (ARMED.some((pattern) => pattern.test(normalized))) return true;
  if (alwaysAsk.some((name) => normalized === normalize(name) || normalized.endsWith(`/${normalize(name)}`))) return true;
  const data = normalize(resolve(dataDir)).replace(/\/+$/, '');
  return normalized === data || normalized.startsWith(`${data}/`);
}

/** The most permissive mode does not survive a restart without a new confirmation. */
export function modeAfterRestart(mode: PlayMode): PlayMode {
  return mode === 'impro' ? 'plume' : mode;
}

function pathOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const path = (input as Record<string, unknown>)['path'];
  return typeof path === 'string' && path !== '' ? path : undefined;
}

function commandOf(input: unknown): CommandLine | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const { program, args } = input as Record<string, unknown>;
  if (typeof program !== 'string') return undefined;
  const list = Array.isArray(args) && args.every((arg) => typeof arg === 'string') ? (args as string[]) : [];
  return { program, args: list };
}

function refusal(mode: PlayMode, effect: KnownEffect): string {
  if (mode === 'lecture' && effect === 'write') {
    return 'Lecture mode: the agent reads and plans; it writes nothing. Present the change as a plan with update_plan instead.';
  }
  if (mode === 'lecture') {
    return 'Lecture mode: the agent reads and plans; it runs nothing. Present what it would run as a plan with update_plan instead.';
  }
  return 'This call is not allowed in this mode.';
}

export class PermissionEngine {
  constructor(private readonly deps: PermissionEngineDeps) {}

  evaluate(query: PermissionQuery): Verdict {
    const declared = KNOWN.has(query.tool.effect);
    const effect: KnownEffect = declared ? query.tool.effect : 'execute';
    let short = MATRIX[query.mode][effect];
    if (effect === 'network' && (this.deps.askBeforeNetwork?.() ?? true)) short = 'ask';
    if (short === 'deny') return { verdict: 'deny', reason: refusal(query.mode, effect) };

    // A write: where it really lands decides — a file that runs later, outside the project, the network.
    if (effect === 'write') {
      const requested = pathOf(query.input);
      if (requested !== undefined) {
        const roots = this.deps.roots(query.projectId);
        const home = this.deps.home ?? homedir();
        let inside = true;
        try {
          resolveInPerimeter(roots, requested, home);
        } catch (error) {
          if (error instanceof NetworkPathError || error instanceof InvalidPathError) {
            return { verdict: 'deny', reason: error.message };
          }
          inside = false;
        }
        const real = inside ? permissionPath(roots, requested, home) : resolve(roots[0] ?? home, requested);
        if (isArmedPath(real, this.deps.dataDir, this.deps.alwaysAsk?.(query.projectId) ?? [])) {
          return { verdict: 'ask', why: 'armed-path' };
        }
        if (!inside) return { verdict: 'ask', why: 'outside-project' };
      }
    }

    if (short === 'allow') return { verdict: 'allow' };
    // An ask of the mode, or of the network: a rule remembered may answer it.
    const command = effect === 'execute' ? commandOf(query.input) : undefined;
    const rules = (this.deps.rules?.(query.projectId) ?? []).filter(isValidRule);
    if (declared && rules.some((rule) => matchesRule(rule, query.tool.name, command))) return { verdict: 'allow' };
    return { verdict: 'ask', why: !declared ? 'undeclared-effect' : effect === 'network' ? 'network' : 'mode' };
  }
}
