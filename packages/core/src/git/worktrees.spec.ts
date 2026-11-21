/**
 * A conversation on its own branch (board « Branches et conversations »,
 * task 6.7): a worktree under `.bonaparte/worktrees/<name>`, on the branch
 * `<prefix><name>` from its base, the ignored files listed copied in, locked
 * while the conversation lives; and what the branch counts against its base
 * — commits ahead, lines added and removed, files changed.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tempRepo, type TempRepo } from '../testing/temp-repo.js';
import { git } from './git.js';
import { branchRoots, branchStatus, commitAll, createWorktree, removeWorktree, repoRoot, uncommittedFiles, unsavedCommits } from './worktrees.js';

let repos: TempRepo[] = [];
afterEach(async () => {
  for (const repo of repos) {
    await git(['worktree', 'unlock', join(repo.dir, '.bonaparte', 'worktrees', 'heures')], repo.dir);
    await git(['worktree', 'remove', '--force', join(repo.dir, '.bonaparte', 'worktrees', 'heures')], repo.dir);
    await repo.remove();
  }
  repos = [];
});

async function repo(files: Record<string, string>, ignored: string[] = []): Promise<TempRepo> {
  const made = await tempRepo(files, ignored);
  repos.push(made);
  return made;
}

// git is slow when the whole suite runs at once.
describe('a conversation on its own branch', { timeout: 30_000 }, () => {
  it('a worktree under .bonaparte/worktrees, on its branch from its base, the listed ignored files copied, locked', async () => {
    const { dir } = await repo({ 'src/format.ts': 'export const a = 1;\n' }, ['.env']);
    await writeFile(join(dir, '.env'), 'API_URL=http://localhost\n');
    expect(await repoRoot(join(dir, 'src'))).toBe(await repoRoot(dir));

    const made = await createWorktree({ repo: dir, name: 'heures', base: 'main', prefix: 'bonaparte/', copy: ['.env', 'missing.txt'] });
    expect(made).toEqual({ dir: join(dir, '.bonaparte', 'worktrees', 'heures'), branch: 'bonaparte/heures' });
    expect(await readFile(join(made.dir, 'src', 'format.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(await readFile(join(made.dir, '.env'), 'utf8')).toBe('API_URL=http://localhost\n');
    expect((await git(['branch', '--show-current'], made.dir)).stdout.trim()).toBe('bonaparte/heures');
    expect((await git(['worktree', 'list', '--porcelain'], dir)).stdout).toMatch(/locked/);
    // The project's own status does not see the worktrees' folder.
    expect((await git(['status', '--porcelain'], dir)).stdout).not.toContain('.bonaparte');
  });

  it('counts the branch against its base: commits ahead, lines, files — what is not committed yet included', async () => {
    const { dir } = await repo({ 'a.ts': 'one\ntwo\n', 'b.ts': 'b\n' });
    const made = await createWorktree({ repo: dir, name: 'heures', base: 'main', prefix: 'bonaparte/' });
    expect(await branchStatus(made.dir, 'main')).toEqual({ ahead: 0, added: 0, removed: 0, files: 0 });

    await writeFile(join(made.dir, 'a.ts'), 'one\nTWO\nthree\n');
    await git(['commit', '-qam', 'change a'], made.dir);
    await writeFile(join(made.dir, 'b.ts'), 'B\n');
    await writeFile(join(made.dir, 'new.ts'), 'x\ny\n');
    expect(await branchStatus(made.dir, 'main')).toEqual({ ahead: 1, added: 5, removed: 2, files: 3 });
    expect(existsSync(join(dir, 'new.ts'))).toBe(false);
  });

  it('archiving: what is not committed is counted; « Commiter d’abord » commits it; after its days, the worktree and its branch go', async () => {
    const { dir } = await repo({ 'a.ts': 'a\n' });
    const made = await createWorktree({ repo: dir, name: 'heures', base: 'main', prefix: 'bonaparte/' });
    expect(await uncommittedFiles(made.dir)).toBe(0);
    await writeFile(join(made.dir, 'a.ts'), 'A\n');
    await writeFile(join(made.dir, 'new.ts'), 'new\n');
    expect(await uncommittedFiles(made.dir)).toBe(2);
    expect(await commitAll(made.dir, 'Work of the conversation')).toBe(true);
    expect(await uncommittedFiles(made.dir)).toBe(0);
    expect((await git(['log', '-1', '--format=%s'], made.dir)).stdout.trim()).toBe('Work of the conversation');

    // Committed, never pushed nor merged: after its days the folder goes, the branch and its commit stay (audit D8).
    expect(await unsavedCommits(dir, made.branch, 'main')).toBe(1);
    expect(await removeWorktree(dir, made.dir, made.branch, 'main')).toEqual({ branch: 'kept', unsaved: 1 });
    expect(existsSync(made.dir)).toBe(false);
    expect((await git(['branch', '--list', made.branch], dir)).stdout.trim()).toBe(made.branch);
    expect((await git(['log', '-1', '--format=%s', made.branch], dir)).stdout.trim()).toBe('Work of the conversation');
  });

  it('a branch merged into its base goes with its folder', async () => {
    const { dir } = await repo({ 'a.ts': 'a\n' });
    const made = await createWorktree({ repo: dir, name: 'heures', base: 'main', prefix: 'bonaparte/' });
    await writeFile(join(made.dir, 'a.ts'), 'A\n');
    expect(await commitAll(made.dir, 'Work')).toBe(true);
    expect((await git(['merge', '-q', '--ff-only', made.branch], dir)).code).toBe(0);
    expect(await unsavedCommits(dir, made.branch, 'main')).toBe(0);
    expect(await removeWorktree(dir, made.dir, made.branch, 'main')).toEqual({ branch: 'deleted', unsaved: 0 });
    expect((await git(['branch', '--list', made.branch], dir)).stdout.trim()).toBe('');
  });

  it('a branch whose commits are all on its upstream goes; one commit more than its upstream keeps it', async () => {
    const { dir } = await repo({ 'a.ts': 'a\n' });
    const remote = await repo({ 'README.md': 'the folder of the remote\n' });
    await git(['init', '-q', '--bare', join(remote.dir, 'origin.git')], remote.dir);
    expect((await git(['remote', 'add', 'origin', join(remote.dir, 'origin.git')], dir)).code).toBe(0);
    const made = await createWorktree({ repo: dir, name: 'heures', base: 'main', prefix: 'bonaparte/' });
    await writeFile(join(made.dir, 'a.ts'), 'A\n');
    expect(await commitAll(made.dir, 'Pushed')).toBe(true);
    expect((await git(['push', '-q', '-u', 'origin', made.branch], made.dir)).code).toBe(0);
    expect(await unsavedCommits(dir, made.branch, 'main')).toBe(0);
    await writeFile(join(made.dir, 'b.ts'), 'b\n');
    expect(await commitAll(made.dir, 'Not pushed')).toBe(true);
    expect(await unsavedCommits(dir, made.branch, 'main')).toBe(1);
    expect(await removeWorktree(dir, made.dir, made.branch, 'main')).toEqual({ branch: 'kept', unsaved: 1 });
    expect((await git(['branch', '--list', made.branch], dir)).stdout.trim()).toBe(made.branch);
  });

  it('a base that is gone: nothing can say the commits are safe — the branch stays', async () => {
    const { dir } = await repo({ 'a.ts': 'a\n' });
    const made = await createWorktree({ repo: dir, name: 'heures', base: 'main', prefix: 'bonaparte/' });
    expect(await unsavedCommits(dir, made.branch, 'gone')).toBeNull();
    expect(await removeWorktree(dir, made.dir, made.branch, 'gone')).toEqual({ branch: 'kept', unsaved: null });
    expect((await git(['branch', '--list', made.branch], dir)).stdout.trim()).toBe(made.branch);
  });

  it('never copies a .env git does not ignore: tracked, or only not ignored, it would be committed', async () => {
    const tracked = await repo({ '.env': 'TOKEN=committed\n', 'a.ts': 'a\n' });
    await writeFile(join(tracked.dir, '.env'), 'TOKEN=secret\n');
    const fromTracked = await createWorktree({ repo: tracked.dir, name: 'heures', base: 'main', prefix: 'bonaparte/', copy: ['.env'] });
    expect(await readFile(join(fromTracked.dir, '.env'), 'utf8')).toBe('TOKEN=committed\n');
    expect(await uncommittedFiles(fromTracked.dir)).toBe(0);

    const seen = await repo({ 'a.ts': 'a\n' });
    await writeFile(join(seen.dir, '.env'), 'TOKEN=secret\n');
    const fromSeen = await createWorktree({ repo: seen.dir, name: 'heures', base: 'main', prefix: 'bonaparte/', copy: ['.env'] });
    expect(existsSync(join(fromSeen.dir, '.env'))).toBe(false);
  });

  it('only the worktrees are out of the project’s status: its own .bonaparte files stay seen', async () => {
    const { dir } = await repo({ 'a.ts': 'a\n' });
    await createWorktree({ repo: dir, name: 'heures', base: 'main', prefix: 'bonaparte/' });
    await mkdir(join(dir, '.bonaparte'), { recursive: true });
    await writeFile(join(dir, '.bonaparte', 'instructions.md'), 'Be brief.\n');
    expect((await git(['status', '--porcelain', '--untracked-files=all'], dir)).stdout).toContain('.bonaparte/instructions.md');
    expect((await git(['status', '--porcelain', '--untracked-files=all'], dir)).stdout).not.toContain('worktrees');
  });

  it('a branch made in a folder of its repository: the project’s folders at the same place in the worktree', () => {
    const worktree = join('C:', 'repo', '.bonaparte', 'worktrees', 'heures');
    expect(branchRoots([join('C:', 'repo', 'packages', 'app'), join('C:', 'elsewhere')], worktree)).toEqual({
      roots: [join(worktree, 'packages', 'app'), join('C:', 'elsewhere')],
      barred: [join('C:', 'repo', 'packages', 'app')],
    });
    expect(branchRoots([join('C:', 'repo')], worktree)).toEqual({ roots: [worktree], barred: [join('C:', 'repo')] });
  });

  it('a folder that is not a repository has no root', async () => {
    const { dir } = await repo({ 'a.ts': 'a\n' });
    await git(['init', '-q'], dir);
    expect(await repoRoot(join(dir, '..'))).toBeNull();
  });
});
