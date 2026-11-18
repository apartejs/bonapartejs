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

import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { PlayMode, ToolEffect, Verdict } from '@aparte/bonaparte-shared';
import type { ToolDef } from '../tools/types.js';
import { contains, InvalidPathError, NetworkPathError, PathOutsideHomeError, permissionPath, realLocation, resolveInPerimeter } from '../project/paths.js';
import { isValidRule, matchesRule, type AllowRule, type CommandLine } from './rules.js';

export interface PermissionQuery {
  tool: ToolDef;
  input: unknown;
  mode: PlayMode;
  projectId?: string;
  agentId?: string;
  /** Where this conversation works when it is not its project's folders: its worktree (task 6.7). */
  roots?: readonly string[];
  /** Folders it never writes: on its own branch, its project's own checkout. */
  barred?: readonly string[];
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
  // Any `<name>.config.<anything>`: what a build tool loads and runs (`webpack.config.babel.js` too).
  /(^|\/)[^/]+\.config\.[^/]+$/,
  /(^|\/)makefile$/,
  /(^|\/)\.env(\.[^/]*)?$/,
  // What « what the project runs » launches, its overrides, and what docker builds (audit 13.4).
  /(^|\/)(docker-)?compose(\.override)?\.ya?ml$/,
  /(^|\/)dockerfile(\.[^/]*)?$/,
  /(^|\/)[^/]+\.dockerfile$/,
  /(^|\/)containerfile(\.[^/]*)?$/,
  // What git's hooks run through their managers, and what direnv runs on entering a folder (audit 13.4).
  /(^|\/)\.pre-commit-config\.ya?ml$/,
  /(^|\/)\.?lefthook(-local)?\.(ya?ml|jsonc?|toml)$/,
  /(^|\/)\.lintstagedrc(\.[^/]*)?$/,
  /(^|\/)\.?simple-git-hooks(\.[^/]*)?$/,
  /(^|\/)\.huskyrc(\.[^/]*)?$/,
  /(^|\/)\.overcommit\.ya?ml$/,
  // A folder of hooks the repository keeps and names in core.hooksPath: its usual names.
  /(^|\/)\.?git-?hooks\//,
  /(^|\/)\.envrc$/,
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

/** Where a folder really is, its links resolved; as spelled when it cannot be read. */
function realPlace(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/** Does writing this file mean running something later? */
export function isArmedPath(path: string, dataDir: string, alwaysAsk: readonly string[] = []): boolean {
  const normalized = normalize(path);
  if (ARMED.some((pattern) => pattern.test(normalized))) return true;
  if (alwaysAsk.some((name) => normalized === normalize(name) || normalized.endsWith(`/${normalize(name)}`))) return true;
  // The judged path is a real one (links resolved): the data folder counts by its spelling and by its real place.
  return [resolve(dataDir), realPlace(resolve(dataDir))].some((dir) => {
    const data = normalize(dir).replace(/\/+$/, '');
    return normalized === data || normalized.startsWith(`${data}/`);
  });
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
    // A third party's plugin runs in a plain Node process: what it declares cannot be held to, so its tool is judged
    // as a program it runs — the network still asked as the network (audit 13.4).
    const untrusted = query.tool.source === 'extension' && query.tool.effect !== 'network';
    const effect: KnownEffect = declared && !untrusted ? query.tool.effect : 'execute';
    let short = MATRIX[query.mode][effect];
    if (effect === 'network' && (this.deps.askBeforeNetwork?.() ?? true)) short = 'ask';
    // Lecture runs nothing: a third party's code included, whatever it says it does.
    if (query.tool.source === 'extension' && query.mode === 'lecture') short = 'deny';
    if (short === 'deny') return { verdict: 'deny', reason: refusal(query.mode, effect) };

    // A write: where it really lands decides — a file that runs later, outside the project, the network.
    if (effect === 'write') {
      const requested = pathOf(query.input);
      if (requested !== undefined) {
        const roots = query.roots ?? this.deps.roots(query.projectId);
        const home = this.deps.home ?? homedir();
        let inside = true;
        try {
          resolveInPerimeter(roots, requested, home);
        } catch (error) {
          // A network path, a stream, or — without a project — a place outside the home folder:
          // never written, whatever the person would answer (security rule 6).
          if (error instanceof NetworkPathError || error instanceof InvalidPathError || error instanceof PathOutsideHomeError) {
            return { verdict: 'deny', reason: error.message };
          }
          inside = false;
        }
        // Outside too, where it really lands decides: a link into .ssh is armed.
        const real = inside ? permissionPath(roots, requested, home) : realLocation(resolve(roots[0] ?? home, requested));
        // On its own branch, the project's own folder is another checkout: never written from here — refused before
        // anything is offered, a file that runs later included (audit 13.4).
        if (!inside && (query.barred ?? []).some((root) => contains(root, real))) {
          return {
            verdict: 'deny',
            reason: `This conversation works on its own branch, in ${roots[0] ?? ''}: write its files there, never in the project's own folder.`,
          };
        }
        // Where it really lands, and the name it was asked under: a link named `.githooks` is armed wherever it leads.
        const alwaysAsk = this.deps.alwaysAsk?.(query.projectId) ?? [];
        const spelled = resolve(roots[0] ?? home, requested);
        if (isArmedPath(real, this.deps.dataDir, alwaysAsk) || isArmedPath(spelled, this.deps.dataDir, alwaysAsk)) {
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
