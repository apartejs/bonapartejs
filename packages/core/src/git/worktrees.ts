/**
 * A conversation on its own branch (board « Branches et conversations »,
 * task 6.7). Its worktree lives under the project, in
 * `.bonaparte/worktrees/<name>`, on the branch `<prefix><name>` from its
 * base; the project's own status never sees that folder (the repository's
 * local exclude, never a file of the project). The ignored files the person
 * lists (a `.env`) are copied in. The worktree is locked while the
 * conversation lives. What the branch counts is against its base: commits
 * ahead, lines added and removed, files — what is not committed yet
 * included.
 */

import { appendFile, copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { git } from './git.js';

export interface Worktree {
  dir: string;
  branch: string;
}

export interface BranchStatus {
  ahead: number;
  added: number;
  removed: number;
  files: number;
}

/** The folder of the repository a folder is in; null outside one. */
export async function repoRoot(dir: string): Promise<string | null> {
  const result = await git(['rev-parse', '--show-toplevel'], dir);
  const root = result.stdout.trim();
  return result.code === 0 && root ? resolve(root) : null;
}

/** The repository's own exclude: `.bonaparte/` out of its status, the project's files untouched. */
async function excludeOurFolder(repo: string): Promise<void> {
  const found = await git(['rev-parse', '--git-path', 'info/exclude'], repo);
  if (found.code !== 0 || !found.stdout.trim()) return;
  const path = found.stdout.trim();
  const exclude = isAbsolute(path) ? path : join(repo, path);
  const said = await readFile(exclude, 'utf8').catch(() => '');
  if (said.split(/\r?\n/).includes('/.bonaparte/')) return;
  await mkdir(dirname(exclude), { recursive: true });
  await appendFile(exclude, `${said === '' || said.endsWith('\n') ? '' : '\n'}/.bonaparte/\n`);
}

const failed = (what: string, stderr: string): Error => new Error(`${what}: ${stderr.trim() || 'git failed'}`);

export async function createWorktree(options: {
  repo: string;
  name: string;
  base: string;
  prefix: string;
  /** Ignored files to copy in, as the person listed them (a `.env`). */
  copy?: readonly string[];
}): Promise<Worktree> {
  const dir = join(options.repo, '.bonaparte', 'worktrees', options.name);
  const branch = `${options.prefix}${options.name}`;
  await excludeOurFolder(options.repo);
  const added = await git(['worktree', 'add', '-b', branch, dir, options.base], options.repo);
  if (added.code !== 0) throw failed(`The branch ${branch} could not be made`, added.stderr);
  for (const file of options.copy ?? []) {
    const from = resolve(options.repo, file);
    const to = resolve(dir, file);
    // Only a file of the project, into the worktree.
    if (!from.startsWith(resolve(options.repo)) || !to.startsWith(dir)) continue;
    try {
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
    } catch {
      // Not there: nothing to copy.
    }
  }
  const locked = await git(['worktree', 'lock', '--reason', 'bonaparte: a conversation works here', dir], options.repo);
  if (locked.code !== 0) throw failed(`The worktree ${dir} could not be locked`, locked.stderr);
  return { dir, branch };
}

/** Lets the worktree go when its conversation does (archived, deleted). */
export async function unlockWorktree(repo: string, dir: string): Promise<void> {
  await git(['worktree', 'unlock', dir], repo);
}

/** Holds it again (a conversation taken out of the archive). */
export async function lockWorktree(repo: string, dir: string): Promise<void> {
  await git(['worktree', 'lock', '--reason', 'bonaparte: a conversation works here', dir], repo);
}

/** What is not committed in a worktree: its files. */
export async function uncommittedFiles(dir: string): Promise<number> {
  const result = await git(['status', '--porcelain'], dir);
  return result.code === 0 ? result.stdout.split('\n').filter(Boolean).length : 0;
}

/** Everything committed, with a message — « Commiter d'abord ». */
export async function commitAll(dir: string, message: string): Promise<boolean> {
  if ((await git(['add', '-A'], dir)).code !== 0) return false;
  return (await git(['commit', '-q', '-m', message], dir)).code === 0;
}

/** A worktree and its branch gone for good (an archived conversation, after its days). */
export async function removeWorktree(repo: string, dir: string, branch: string): Promise<void> {
  await git(['worktree', 'unlock', dir], repo);
  await git(['worktree', 'remove', '--force', dir], repo);
  await git(['branch', '-D', branch], repo);
}

const linesOf = (text: string): number => (text === '' ? 0 : text.replace(/\n$/, '').split('\n').length);

export async function branchStatus(dir: string, base: string): Promise<BranchStatus> {
  const ahead = Number.parseInt((await git(['rev-list', '--count', `${base}..HEAD`], dir)).stdout.trim(), 10) || 0;
  let added = 0;
  let removed = 0;
  let files = 0;
  for (const line of (await git(['diff', '--numstat', base], dir)).stdout.split('\n')) {
    const [plus, minus] = line.split('\t');
    if (plus === undefined || minus === undefined) continue;
    files += 1;
    added += Number.parseInt(plus, 10) || 0;
    removed += Number.parseInt(minus, 10) || 0;
  }
  for (const path of (await git(['ls-files', '--others', '--exclude-standard'], dir)).stdout.split('\n').filter(Boolean)) {
    files += 1;
    const text = await readFile(join(dir, path), 'utf8').catch(() => '');
    if (!text.includes('\u0000')) added += linesOf(text);
  }
  return { ahead, added, removed, files };
}
