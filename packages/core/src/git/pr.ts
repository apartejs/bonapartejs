/**
 * The pull request of a conversation's branch (board « Branches et
 * conversations », task 6.8), through GitHub's CLI as it is installed —
 * `gh pr view <branch> --json number,state,url,statusCheckRollup` — run as
 * every process is, through `spawnHidden`. Without the CLI, or with no pull
 * request, there is none to show. One is opened on the person's word only
 * (audit 2026-11-21, D7): what goes is said first — the remote and its
 * address, the branch, its commits, what is not committed —, a title and a
 * description the person may change; the branch pushed to itself on that
 * remote, never forced, never to the default branch; then
 * `gh pr create --title --body`. A failure says which, in its own words.
 */

import { withoutSecrets } from '../process/env.js';
import { spawnHidden } from '../process/spawn.js';
import { git, type GitResult } from './git.js';

export interface PrStatus {
  number: number;
  state: 'open' | 'merged' | 'closed';
  url: string;
  /** Its checks as a person reads them; null without any. */
  ci: 'success' | 'failure' | 'pending' | null;
}

/** The CLI: its command and its first arguments (a fake one in tests); null for none. */
export type GhCommand = readonly string[] | null;

interface Check {
  conclusion?: string | null;
  status?: string | null;
  state?: string | null;
}

const FAILED = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const RUNNING = new Set(['IN_PROGRESS', 'QUEUED', 'PENDING', 'WAITING', 'REQUESTED', 'EXPECTED']);

/** Failed if one failed, running if one runs, passed if all passed; null without checks. */
export function ciOf(checks: readonly Check[]): PrStatus['ci'] {
  if (checks.length === 0) return null;
  const said = (check: Check): string => (check.conclusion ?? check.state ?? check.status ?? '').toUpperCase();
  if (checks.some((check) => FAILED.has(said(check)))) return 'failure';
  if (checks.some((check) => RUNNING.has(said(check)) || RUNNING.has((check.status ?? '').toUpperCase()))) return 'pending';
  return 'success';
}

/**
 * GitHub's CLI signs in with its own token, the one variable of the kind it keeps; the app's other secrets stay
 * out of it, and of the hooks a push makes git run (audit 13.4).
 */
export function ghEnvironment(base: Record<string, string | undefined>): Record<string, string> {
  const own: Record<string, string> = {};
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST']) {
    const value = base[name];
    if (value) own[name] = value;
  }
  return { ...withoutSecrets(base), ...own, GH_PROMPT_DISABLED: '1' };
}

function run(gh: readonly string[], args: readonly string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawnHidden(gh[0]!, [...gh.slice(1), ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: ghEnvironment(process.env) });
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: String(error) });
      return;
    }
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    // Not installed: no pull request to show, never an error.
    child.on('error', () => resolve({ code: null, stdout, stderr }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

export async function prStatus(gh: GhCommand, dir: string, branch: string): Promise<PrStatus | null> {
  if (!gh || gh.length === 0) return null;
  const result = await run(gh, ['pr', 'view', branch, '--json', 'number,state,url,statusCheckRollup'], dir);
  if (result.code !== 0) return null;
  try {
    const pr = JSON.parse(result.stdout) as { number?: unknown; state?: unknown; url?: unknown; statusCheckRollup?: unknown };
    if (typeof pr.number !== 'number' || typeof pr.url !== 'string') return null;
    const state = String(pr.state).toLowerCase();
    return {
      number: pr.number,
      state: state === 'merged' ? 'merged' : state === 'closed' ? 'closed' : 'open',
      url: pr.url,
      ci: ciOf(Array.isArray(pr.statusCheckRollup) ? (pr.statusCheckRollup as Check[]) : []),
    };
  } catch {
    return null;
  }
}


/** The remote a branch goes to: its name, and its address with no user nor password in it. */
export interface PrRemote {
  name: string;
  url: string;
}

/** Why a pull request is not opened, or could not be: said to the person in their words. */
export type PrRefusal =
  | 'no-gh'
  | 'no-remote'
  | 'default-branch'
  | 'no-commits'
  | 'push-rejected'
  | 'push-denied'
  | 'offline'
  | 'gh-auth'
  | 'exists'
  | 'failed';

/** What « Pousser et ouvrir » would do, said before anything goes (audit D7). */
export interface PrPlan {
  branch: string;
  base: string;
  remote: PrRemote | null;
  /** The commits that go, newest first (at most `PLAN_COMMITS` listed); `count` all of them. */
  commits: { hash: string; subject: string }[];
  count: number;
  /** Files changed and not committed: they do not go. */
  uncommitted: number;
  /** A title and a description to start from, read from the commits: the person may change both. */
  title: string;
  body: string;
  /** Why it cannot go as it is; none when it can. */
  refused?: Extract<PrRefusal, 'no-gh' | 'no-remote' | 'default-branch' | 'no-commits'>;
}

export type PrOpened = { ok: true; pr: PrStatus | null } | { ok: false; reason: PrRefusal; detail: string };

const PLAN_COMMITS = 20;

/** An address as it may be shown: `https://user:token@host/x` loses its user and token. */
export function shownRemoteUrl(url: string): string {
  return url.trim().replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1');
}

/** The remote a branch goes to: its upstream's, else `origin`, else the only one. */
async function remoteOf(dir: string, branch: string): Promise<PrRemote | null> {
  const configured = (await git(['config', '--get', `branch.${branch}.remote`], dir)).stdout.trim();
  const names = (await git(['remote'], dir)).stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const name = configured && names.includes(configured) ? configured : names.includes('origin') ? 'origin' : names.length === 1 ? names[0]! : null;
  if (!name) return null;
  const url = (await git(['remote', 'get-url', name], dir)).stdout.trim();
  return url ? { name, url: shownRemoteUrl(url) } : null;
}

/** The remote's default branch as git last heard it (`refs/remotes/<remote>/HEAD`); null when not known. */
async function defaultBranchOf(dir: string, remote: string): Promise<string | null> {
  const head = (await git(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], dir)).stdout.trim();
  return head.startsWith(`${remote}/`) ? head.slice(remote.length + 1) : null;
}

/**
 * Never to the default branch: the branch must be the conversation's own — not its base, not the remote's
 * default branch, not one of the names a default branch takes.
 */
async function isDefaultBranch(dir: string, branch: string, base: string, remote: string | null): Promise<boolean> {
  const named = new Set(['main', 'master', 'trunk', base.replace(/^refs\/heads\//, '')]);
  const known = remote ? await defaultBranchOf(dir, remote) : null;
  if (known) named.add(known);
  return named.has(branch);
}

/** A title and a description to start from: one commit's own words, else the conversation's title and the commits. */
export function proposeText(commits: readonly { subject: string }[], fallbackTitle: string): { title: string; body: string } {
  if (commits.length === 1) return { title: commits[0]!.subject, body: '' };
  const title = fallbackTitle.trim() || commits.at(-1)?.subject || '';
  // Oldest first, as the work was done.
  return { title, body: [...commits].reverse().map((commit) => `- ${commit.subject}`).join('\n') };
}

/** What « Pousser et ouvrir » would do: said first, nothing run but reads. */
export async function prPlan(gh: GhCommand, dir: string, branch: string, base: string, fallbackTitle: string): Promise<PrPlan> {
  const remote = await remoteOf(dir, branch);
  const listed = await git(['log', '--format=%h%x09%s', `${base}..${branch}`], dir);
  const lines = listed.code === 0 ? listed.stdout.split('\n').filter(Boolean) : [];
  const commits = lines.map((line) => {
    const tab = line.indexOf('\t');
    return { hash: line.slice(0, tab), subject: line.slice(tab + 1) };
  });
  const status = await git(['status', '--porcelain'], dir);
  const uncommitted = status.code === 0 ? status.stdout.split('\n').filter(Boolean).length : 0;
  const text = proposeText(commits, fallbackTitle);
  const refused: PrPlan['refused'] =
    !gh || gh.length === 0
      ? 'no-gh'
      : !remote
        ? 'no-remote'
        : (await isDefaultBranch(dir, branch, base, remote.name))
          ? 'default-branch'
          : commits.length === 0
            ? 'no-commits'
            : undefined;
  return { branch, base, remote, commits: commits.slice(0, PLAN_COMMITS), count: commits.length, uncommitted, ...text, ...(refused ? { refused } : {}) };
}

/** The first line that says something, for the person to read beside the reason. */
function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '' && !/^(hint:|to |remote:\s*$)/i.test(line)) ?? ''
  ).slice(0, 240);
}

/** What a push that failed says, in the person's words. */
export function pushRefusal(stderr: string): PrRefusal {
  if (/\[rejected\]|non-fast-forward|fetch first|stale info|\(rejected\)/i.test(stderr)) return 'push-rejected';
  if (/could not resolve host|unable to access.*(timed out|resolve)|network is unreachable|connection (timed out|refused)/i.test(stderr)) return 'offline';
  if (/permission denied|authentication failed|could not read username|403|access denied|not authorized|protected branch|GH006|pre-receive hook declined/i.test(stderr)) return 'push-denied';
  if (/does not appear to be a git repository|no such remote|repository not found/i.test(stderr)) return 'no-remote';
  return 'failed';
}

/** What GitHub's CLI said when it opened nothing, in the person's words. */
export function ghRefusal(stderr: string): PrRefusal {
  if (/gh auth login|not logged in|authentication|HTTP 401|bad credentials/i.test(stderr)) return 'gh-auth';
  if (/already exists/i.test(stderr)) return 'exists';
  if (/no commits between/i.test(stderr)) return 'no-commits';
  if (/could not resolve|connection|timed out|network/i.test(stderr)) return 'offline';
  return 'failed';
}

/**
 * The branch pushed to itself on its remote — never forced (no `--force`, no `+`, an explicit refspec that a
 * remote's own push settings cannot change), never to the default branch —, then its pull request opened with the
 * person's title and description. Each failure says which; nothing is retried.
 */
export async function openPr(
  gh: GhCommand,
  dir: string,
  branch: string,
  base: string,
  text: { title: string; body: string },
  push: (args: string[]) => Promise<GitResult> = (args) => git(args, dir),
): Promise<PrOpened> {
  const plan = await prPlan(gh, dir, branch, base, text.title);
  if (plan.refused) return { ok: false, reason: plan.refused, detail: '' };
  const remote = plan.remote!;
  // GitHub's CLI first, signed in: nothing goes out that no pull request would follow.
  const signed = await run(gh!, ['auth', 'status'], dir);
  if (signed.code === null) return { ok: false, reason: 'no-gh', detail: firstLine(signed.stderr) };
  if (signed.code !== 0) {
    const said = `${signed.stderr}\n${signed.stdout}`;
    return { ok: false, reason: ghRefusal(said) === 'offline' ? 'offline' : 'gh-auth', detail: firstLine(signed.stderr) || firstLine(signed.stdout) };
  }
  const pushed = await push(['push', '--porcelain', '-u', remote.name, `refs/heads/${branch}:refs/heads/${branch}`]);
  if (pushed.code !== 0) {
    const said = `${pushed.stderr}\n${pushed.stdout}`;
    return { ok: false, reason: pushRefusal(said), detail: firstLine(pushed.stderr) || firstLine(pushed.stdout) };
  }
  const title = text.title.trim() || plan.title;
  const created = await run(gh!, ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', text.body], dir);
  if (created.code === null) return { ok: false, reason: 'no-gh', detail: firstLine(created.stderr) };
  if (created.code !== 0) return { ok: false, reason: ghRefusal(created.stderr), detail: firstLine(created.stderr) };
  return { ok: true, pr: await prStatus(gh, dir, branch) };
}
