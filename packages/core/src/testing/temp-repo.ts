/**
 * A git repository of a test: a temporary folder, its files committed on
 * `main`, an author of the test's own. Git runs through `spawnHidden`, as
 * everywhere else.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { git } from '../git/git.js';

export interface TempRepo {
  dir: string;
  remove(): Promise<void>;
}

export async function tempRepo(files: Record<string, string>, ignored: string[] = []): Promise<TempRepo> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-repo-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  if (ignored.length > 0) await writeFile(join(dir, '.gitignore'), `${ignored.join('\n')}\n`);
  const run = async (...args: string[]): Promise<void> => {
    const result = await git(args, dir);
    if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  };
  await run('init', '-q', '-b', 'main');
  await run('config', 'user.email', 'test@example.invalid');
  await run('config', 'user.name', 'Test');
  await run('config', 'commit.gpgsign', 'false');
  await run('config', 'core.autocrlf', 'false');
  await run('add', '-A');
  await run('commit', '-q', '-m', 'first');
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}
