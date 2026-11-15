/**
 * A conversation on its own branch (board « Branches et conversations »,
 * task 6.7): a worktree under `.bonaparte/worktrees/<name>`, on the branch
 * `<prefix><name>` from its base, the ignored files listed copied in, locked
 * while the conversation lives; and what the branch counts against its base
 * — commits ahead, lines added and removed, files changed.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tempRepo, type TempRepo } from '../testing/temp-repo.js';
import { git } from './git.js';
import { branchStatus, createWorktree, repoRoot } from './worktrees.js';

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

describe('a conversation on its own branch', () => {
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

  it('a folder that is not a repository has no root', async () => {
    const { dir } = await repo({ 'a.ts': 'a\n' });
    await git(['init', '-q'], dir);
    expect(await repoRoot(join(dir, '..'))).toBeNull();
  });
});
