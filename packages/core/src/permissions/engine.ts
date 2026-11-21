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
 * - going online asks in Lecture, Répétition and Plume while « ask before the network » is on, never in Impro —
 *   but a third party's plugin asks in every mode, whatever the setting;
 * - a tool that does not say what it does is taken as one that runs something;
 * - a rule remembered turns an ask of the mode (or of the network) into an
 *   allow — never a refusal, never a file that runs later, never a write
 *   outside the project, never a third party's tool (audit 2026-11-21, D3);
 * - on a page, what is always confirmed (a password typed, a form sent, a file
 *   chosen to upload) is asked every time, in every mode that acts: the
 *   browser refuses it unless the call says `confirm`, and a call that says it
 *   is always asked.
 */

import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { relative, resolve, sep } from 'node:path';
import type { PlayMode, ToolEffect, Verdict } from '@aparte/bonaparte-shared';
import type { ToolDef } from '../tools/types.js';
import { contains, InvalidPathError, NetworkPathError, PathOutsideHomeError, permissionPath, realLocation, resolveInPerimeter } from '../project/paths.js';
import { isValidRule, matchesRule, originOf, ruleFor, type AllowRule, type CallSubject, type CommandLine, type NeverRemembered } from './rules.js';

export interface PermissionQuery {
  tool: ToolDef;
  input: unknown;
  mode: PlayMode;
  projectId?: string;
  /** Its conversation: whose own rules answer too, and whose agent's page a browser_act acts on. */
  conversationId?: string;
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
  /** The rules « always allow » remembered: the app's, the project's and the conversation's own (audit D3). */
  rules?(projectId: string | undefined, conversationId: string | undefined): readonly AllowRule[];
  /**
   * The address of a conversation's agent's page, as the core last heard it: the site a browser_act acts on. Read
   * synchronously — a service's approval policy cannot await (apartejs/aparte#291) —, and checked again in the page
   * as it acts; what the page always confirms is refused there unless the call says `confirm`.
   */
  pageOf?(conversationId: string): string | undefined;
  /** « Ask before going online » (on by default). */
  askBeforeNetwork?(): boolean;
  /** What a project adds to the files always asked (« Dockerfile »). */
  alwaysAsk?(projectId: string | undefined): readonly string[];
  /** Tests only. */
  home?: string;
}

type Short = 'allow' | 'ask' | 'deny';
type KnownEffect = Exclude<ToolEffect, never>;

// The network is asked by « ask before the network » (on by default) in the first three modes; Impro never asks for
// the app's own network (Paul, 2026-11-20). A third party's code is asked whatever the setting says.
const MATRIX: Record<PlayMode, Record<KnownEffect, Short>> = {
  lecture: { read: 'allow', write: 'deny', execute: 'deny', network: 'allow', ui: 'allow' },
  repetition: { read: 'allow', write: 'ask', execute: 'ask', network: 'allow', ui: 'allow' },
  plume: { read: 'allow', write: 'allow', execute: 'ask', network: 'allow', ui: 'allow' },
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

function refusal(mode: PlayMode, effect: KnownEffect, subagent: boolean): string {
  // A sub-agent presents no plan: that is the main agent's work (audit S2). It hands back what it would do.
  if (mode === 'lecture' && subagent) {
    return effect === 'write'
      ? 'Lecture mode: this conversation reads and plans; a sub-agent writes nothing. Do not try again: answer the main agent with what you found, and what you would write (the path, and the change).'
      : 'Lecture mode: this conversation reads and plans; a sub-agent runs nothing. Do not try again: answer the main agent with what you found, and what you would run.';
  }
  if (mode === 'lecture' && effect === 'write') {
    return 'Lecture mode: the agent reads and plans; it writes nothing. Present the change as a plan with update_plan instead.';
  }
  if (mode === 'lecture') {
    return 'Lecture mode: the agent reads and plans; it runs nothing. Present what it would run as a plan with update_plan instead.';
  }
  return 'This call is not allowed in this mode.';
}

/** The built-in browser's tool, not a third party's of the same name. */
function builtinBrowser(tool: ToolDef, name: string): boolean {
  return tool.source === 'plugin' && tool.name === name;
}

/**
 * What a call does: what its tool declares — but one browser_open opens a page or a file (Paul, 2026-11-20): a file
 * of the project (`path`, or a `file:` address) is a read, which the host checks is in the perimeter; an address
 * is the network.
 */
export function effectOfCall(tool: ToolDef, input: unknown): ToolEffect {
  if (!builtinBrowser(tool, 'browser_open') || typeof input !== 'object' || input === null) return tool.effect;
  const { url, path } = input as Record<string, unknown>;
  if (typeof url === 'string' && url.trim() !== '') return /^\s*file:/i.test(url) ? 'read' : tool.effect;
  return typeof path === 'string' && path.trim() !== '' ? 'read' : tool.effect;
}


/** Where a write lands, relative to the folder of the perimeter that holds it, `/`-separated; null outside every one. */
function relativeIn(roots: readonly string[], real: string): string | null {
  for (const root of roots) {
    for (const place of new Set([resolve(root), realPlace(resolve(root))])) {
      if (!contains(place, real)) continue;
      const rel = relative(place, real);
      return rel === '' ? null : rel.split(sep).join('/');
    }
  }
  return null;
}

/** A browser_act that says it does what is always asked (a password, a form sent, a file chosen). */
function confirms(input: unknown): boolean {
  return typeof input === 'object' && input !== null && (input as Record<string, unknown>)['confirm'] === true;
}

function urlOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const url = (input as Record<string, unknown>)['url'];
  return typeof url === 'string' && url.trim() !== '' ? url : undefined;
}

/** What « always allow » may remember for a call that asks: its rule and where it is kept — or why nothing. */
export type RememberOffer = { rule: AllowRule; where: 'app' | 'project' } | { never: NeverRemembered };

interface Judgment {
  verdict: Verdict;
  /** An ask a remembered rule may answer: what the call names. Absent: nothing answers it. */
  answerable?: CallSubject;
  /** Why it cannot be remembered, when it asks and nothing answers it. */
  never?: NeverRemembered;
}

export class PermissionEngine {
  constructor(
    private readonly deps: PermissionEngineDeps,
    private readonly kind: 'code' | 'discussion' = 'code',
  ) {}

  /** The same policy for a discussion: in Lecture for want of a project, the built-in browser's act asked per site. */
  forDiscussion(): PermissionEngine {
    return new PermissionEngine(this.deps, 'discussion');
  }

  evaluate(query: PermissionQuery): Verdict {
    const judged = this.judge(query);
    if (judged.verdict.verdict !== 'ask' || !judged.answerable) return judged.verdict;
    const subject = judged.answerable;
    const rules = (this.deps.rules?.(query.projectId, query.conversationId) ?? []).filter(isValidRule);
    return rules.some((rule) => matchesRule(rule, query.tool.name, subject)) ? { verdict: 'allow' } : judged.verdict;
  }

  /**
   * What the card may offer to remember for a call that asks (audit D3): the rule — the exact command, the file's
   * folder, the page's site, or the tool — and where « Toujours » keeps it (a site for the whole app, the rest for
   * the project); or why it is asked every time. Null for a call that does not ask.
   */
  offer(query: PermissionQuery): RememberOffer | null {
    const judged = this.judge(query);
    if (judged.verdict.verdict !== 'ask') return null;
    if (!judged.answerable) return { never: judged.never ?? 'unknown' };
    const rule = ruleFor(query.tool.name, judged.answerable);
    if ('never' in rule) return rule;
    return { rule, where: rule.origin !== undefined || !query.projectId ? 'app' : 'project' };
  }

  /** The site of the conversation's agent's page, as the core last heard it. */
  private pageSite(query: PermissionQuery): CallSubject {
    const url = query.conversationId ? this.deps.pageOf?.(query.conversationId) : undefined;
    return { kind: 'origin', origin: url ? originOf(url) : null };
  }

  private judge(query: PermissionQuery): Judgment {
    const act = builtinBrowser(query.tool, 'browser_act');
    // A discussion has the whole built-in browser (Paul, 2026-11-20): acting on a page is asked per site — never
    // refused by the Lecture it runs in; what is always confirmed is asked every time.
    if (this.kind === 'discussion' && act) {
      if (confirms(query.input)) return { verdict: { verdict: 'ask', why: 'sensitive' }, never: 'sensitive' };
      return { verdict: { verdict: 'ask', why: 'mode' }, answerable: this.pageSite(query) };
    }
    const called = effectOfCall(query.tool, query.input);
    const declared = KNOWN.has(called);
    // A third party's plugin runs in a plain Node process: what it declares cannot be held to, so its tool is judged
    // as a program it runs — the network still asked as the network (audit 13.4).
    const untrusted = query.tool.source === 'extension' && called !== 'network';
    const effect: KnownEffect = declared && !untrusted ? (called as KnownEffect) : 'execute';
    let short = MATRIX[query.mode][effect];
    if (effect === 'network') {
      const asked = query.tool.source === 'extension' || (query.mode !== 'impro' && (this.deps.askBeforeNetwork?.() ?? true));
      if (asked) short = 'ask';
    }
    // Lecture runs nothing: a third party's code included, whatever it says it does.
    if (query.tool.source === 'extension' && query.mode === 'lecture') short = 'deny';
    if (short === 'deny') return { verdict: { verdict: 'deny', reason: refusal(query.mode, effect, query.agentId !== undefined) } };
    // What a page always confirms is asked in every mode that acts, Impro included.
    if (act && confirms(query.input)) return { verdict: { verdict: 'ask', why: 'sensitive' }, never: 'sensitive' };

    // A write: where it really lands decides — a file that runs later, outside the project, the network.
    let landed: string | null = null;
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
            return { verdict: { verdict: 'deny', reason: error.message } };
          }
          inside = false;
        }
        // Outside too, where it really lands decides: a link into .ssh is armed.
        const real = inside ? permissionPath(roots, requested, home) : realLocation(resolve(roots[0] ?? home, requested));
        // On its own branch, the project's own folder is another checkout: never written from here — refused before
        // anything is offered, a file that runs later included (audit 13.4).
        if (!inside && (query.barred ?? []).some((root) => contains(root, real))) {
          return {
            verdict: {
              verdict: 'deny',
              reason: `This conversation works on its own branch, in ${roots[0] ?? ''}: write its files there, never in the project's own folder.`,
            },
          };
        }
        // Where it really lands, and the name it was asked under: a link named `.githooks` is armed wherever it leads.
        const alwaysAsk = this.deps.alwaysAsk?.(query.projectId) ?? [];
        const spelled = resolve(roots[0] ?? home, requested);
        if (isArmedPath(real, this.deps.dataDir, alwaysAsk) || isArmedPath(spelled, this.deps.dataDir, alwaysAsk)) {
          return { verdict: { verdict: 'ask', why: 'armed-path' }, never: 'armed' };
        }
        if (!inside) return { verdict: { verdict: 'ask', why: 'outside-project' }, never: 'outside' };
        landed = relativeIn(roots.length > 0 ? roots : [home], real);
      }
    }

    if (short === 'allow') return { verdict: { verdict: 'allow' } };
    const verdict: Verdict = { verdict: 'ask', why: !declared ? 'undeclared-effect' : effect === 'network' ? 'network' : 'mode' };
    // A third party's tool, or one that does not say what it does: asked every time, never remembered.
    if (!declared || query.tool.source === 'extension') return { verdict, never: 'third-party' };
    // An ask of the mode, or of the network: what the call names is what a rule may answer for.
    const command = effect === 'execute' ? commandOf(query.input) : undefined;
    const url = effect === 'network' ? urlOf(query.input) : undefined;
    let subject: CallSubject;
    if (act) subject = this.pageSite(query);
    else if (command) subject = { kind: 'command', command };
    else if (effect === 'write' && pathOf(query.input) !== undefined) subject = { kind: 'path', relative: landed };
    else if (url !== undefined) subject = { kind: 'origin', origin: originOf(url) };
    else subject = { kind: 'none' };
    return { verdict, answerable: subject };
  }
}
