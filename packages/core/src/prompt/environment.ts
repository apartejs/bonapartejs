/**
 * Where the model works, as it is told (audit 2026-11-21, I1). The platform is the machine's: it goes in the shared
 * system turn, whose seed every conversation of the machine reads. The date, the branch and what is not committed
 * are this conversation's: they are frozen in its own turn — read when the prompt is frozen (its first turn, a
 * compaction, a change of model), never again in between: the frozen prompt is not rendered again.
 */

import { currentBranch } from '../git/branch.js';
import { git } from '../git/git.js';

/** The lines of `git status --short` said, at most; the rest is counted. */
const STATUS_LINES = 20;

export interface PromptEnvironment {
  /** The local date, YYYY-MM-DD. */
  date: string;
  /** In a git repository: its branch ('' when detached) and `git status --short`, one line a file. */
  git?: { branch: string; status: string[] };
  /**
   * A conversation that works on its own branch, not made yet (review of round 2, 8): the branch it will work on
   * and its base — never the checkout's state, which is not its own.
   */
  ownBranch?: { branch: string; base: string };
}

/** The platform, as people name it. */
export function platformName(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return platform;
}

function localDate(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The date; in a git repository, its branch and its status. `root`: the folder relative paths resolve from. */
export async function readEnvironment(root: string | undefined, now: Date = new Date()): Promise<PromptEnvironment> {
  const environment: PromptEnvironment = { date: localDate(now) };
  if (!root) return environment;
  const status = await git(['status', '--short', '--untracked-files=normal'], root);
  // Not a repository, or no git: nothing said of it.
  if (status.code !== 0) return environment;
  const lines = status.stdout.split(/\r?\n/).filter((line) => line.trim() !== '');
  return { ...environment, git: { branch: await currentBranch(root), status: lines } };
}

export function renderEnvironment(environment: PromptEnvironment): string {
  const lines = [`Today is ${environment.date}.`];
  const repo = environment.git;
  if (environment.ownBranch) {
    const { branch, base } = environment.ownBranch;
    lines.push(`Git: you will work on branch ${branch}, made from ${base} at your first change; the project’s own checkout is not yours.`);
  } else if (repo) {
    const where = repo.branch ? `branch ${repo.branch}` : 'detached HEAD';
    const count = repo.status.length;
    if (count === 0) {
      lines.push(`Git: ${where}, nothing to commit.`);
    } else {
      lines.push(`Git: ${where}, ${count} file${count === 1 ? '' : 's'} not committed:`);
      lines.push(...repo.status.slice(0, STATUS_LINES));
      if (count > STATUS_LINES) lines.push(`… and ${count - STATUS_LINES} more.`);
    }
  }
  return lines.join('\n');
}
