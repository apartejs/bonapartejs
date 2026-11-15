/**
 * The pull request of a conversation's branch (board « Branches et
 * conversations », task 6.8), through GitHub's CLI as it is installed —
 * `gh pr view <branch> --json number,state,url,statusCheckRollup` — run as
 * every process is, through `spawnHidden`. Without the CLI, or with no pull
 * request, there is none to show. One is opened on the person's word only:
 * the branch pushed, then `gh pr create --fill`.
 */

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

function run(gh: readonly string[], args: readonly string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawnHidden(gh[0]!, [...gh.slice(1), ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GH_PROMPT_DISABLED: '1' } });
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

/** The branch pushed, then its pull request opened; null when either failed. */
export async function openPr(
  gh: GhCommand,
  dir: string,
  branch: string,
  base: string,
  push: (args: string[]) => Promise<GitResult> = (args) => git(args, dir),
): Promise<PrStatus | null> {
  if (!gh || gh.length === 0) return null;
  const pushed = await push(['push', '-u', 'origin', branch]);
  if (pushed.code !== 0) return null;
  const created = await run(gh, ['pr', 'create', '--fill', '--base', base, '--head', branch], dir);
  if (created.code !== 0) return null;
  return prStatus(gh, dir, branch);
}
