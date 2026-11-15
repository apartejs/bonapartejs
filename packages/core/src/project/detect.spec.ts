/**
 * What a folder already says about the project it holds, read before the
 * person creates one (board « Nouveau projet »): its git repository and
 * branch, its package manager and scripts, its instructions file, the
 * services of its compose file. Reading only — nothing is written in the
 * person's folder, and nothing is run.
 */

import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectProject } from './detect.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-detect-'));
  dirs.push(dir);
  return dir;
}

describe('detectProject', () => {
  it('reads a repository: its branch, its package manager and scripts, its instructions, its services', async () => {
    const dir = await folder();
    await mkdir(join(dir, '.git'));
    await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/feature/export\n');
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'spanwise', packageManager: 'pnpm@10.32.1', scripts: { dev: 'vite', test: 'vitest', build: 'tsc' } }),
    );
    await writeFile(join(dir, 'AGENTS.md'), '# Rules\n');
    await writeFile(
      join(dir, 'docker-compose.yml'),
      'version: "3"\nservices:\n  db:\n    image: postgres\n    ports:\n      - "5432:5432"\n  cache:\n    image: redis\nvolumes:\n  data: {}\n',
    );
    expect(await detectProject(dir)).toEqual({
      name: basename(dir),
      git: { branch: 'feature/export' },
      packageManager: 'pnpm',
      scripts: ['dev', 'test', 'build'],
      instructions: 'AGENTS.md',
      services: ['db', 'cache'],
    });
  });

  it('knows the package manager by its lock file when package.json does not say', async () => {
    for (const [lock, manager] of [
      ['pnpm-lock.yaml', 'pnpm'],
      ['yarn.lock', 'yarn'],
      ['bun.lock', 'bun'],
      ['package-lock.json', 'npm'],
    ] as const) {
      const dir = await folder();
      await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: {} }));
      await writeFile(join(dir, lock), '');
      expect((await detectProject(dir)).packageManager, lock).toBe(manager);
    }
  });

  it('a detached head is named by its commit; a worktree points to its git folder', async () => {
    const dir = await folder();
    await mkdir(join(dir, '.git'));
    await writeFile(join(dir, '.git', 'HEAD'), '3f2a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a\n');
    expect((await detectProject(dir)).git).toEqual({ branch: null, commit: '3f2a1b9' });

    const main = await folder();
    await mkdir(join(main, 'worktrees', 'wt'), { recursive: true });
    await writeFile(join(main, 'worktrees', 'wt', 'HEAD'), 'ref: refs/heads/bonaparte/export\n');
    const tree = await folder();
    await writeFile(join(tree, '.git'), `gitdir: ${join(main, 'worktrees', 'wt')}\n`);
    expect((await detectProject(tree)).git).toEqual({ branch: 'bonaparte/export' });
  });

  it('a plain folder is a project too: nothing detected, nothing invented', async () => {
    const dir = await folder();
    expect(await detectProject(dir)).toEqual({
      name: basename(dir),
      git: null,
      packageManager: null,
      scripts: [],
      instructions: null,
      services: [],
    });
  });

  it("writes nothing in the person's folder", async () => {
    const dir = await folder();
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'x' } }));
    const before = { names: await readdir(dir), at: (await stat(dir)).mtimeMs };
    await detectProject(dir);
    expect(await readdir(dir)).toEqual(before.names);
    expect((await stat(dir)).mtimeMs).toBe(before.at);
  });

  it('a package.json it cannot read is no script, never a failure', async () => {
    const dir = await folder();
    await writeFile(join(dir, 'package.json'), '{ not json');
    expect((await detectProject(dir)).scripts).toEqual([]);
  });
});
