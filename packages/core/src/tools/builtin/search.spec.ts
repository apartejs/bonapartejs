/**
 * search: a regular expression across the files of the project, as
 * `path:line: text`. It runs in a worker thread, apart from the app: it can
 * be stopped, and it stops by itself after its time limit — an expression
 * that backtracks for ever never blocks the app (security rule 7).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolContext } from '../types.js';
import { createSearchTool, search } from './search.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function project(signal = new AbortController().signal): Promise<ToolContext> {
  const root = await mkdtemp(join(tmpdir(), 'bp-search-'));
  dirs.push(root);
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'node_modules', 'dep'), { recursive: true });
  await writeFile(join(root, 'src', 'a.ts'), 'const a = 1;\nconst hours = 7.5;\n');
  await writeFile(join(root, 'src', 'b.ts'), 'export const hours = 8;\n');
  await writeFile(join(root, 'node_modules', 'dep', 'index.js'), 'const hours = 0;\n');
  // A conversation's own branch: a copy of the project, never walked from it.
  await mkdir(join(root, '.bonaparte', 'worktrees', 'heures', 'src'), { recursive: true });
  await writeFile(join(root, '.bonaparte', 'worktrees', 'heures', 'src', 'a.ts'), 'const hours = 9;\n');
  return { conversationId: 'c1', roots: [root], nCtx: 8_192, signal };
}

describe('search', () => {
  it('finds the lines that match, as path:line: text, in order — never in node_modules, nor in a branch’s worktree', async () => {
    const ctx = await project();
    const result = await search.handler({ id: 't1', name: 'search', input: { pattern: 'hours =' } }, ctx);
    expect(result.content).toBe('src/a.ts:2: const hours = 7.5;\nsrc/b.ts:1: export const hours = 8;');
  });

  it('says when nothing matches, and refuses an expression that is not one', async () => {
    const ctx = await project();
    expect((await search.handler({ id: 't1', name: 'search', input: { pattern: 'nowhere' } }, ctx)).content).toBe('No match.');
    expect(await search.handler({ id: 't1', name: 'search', input: { pattern: '(' } }, ctx)).toMatchObject({ failed: true });
  });

  it('stays in the perimeter', async () => {
    const ctx = await project();
    expect(await search.handler({ id: 't1', name: 'search', input: { pattern: 'x', path: '../..' } }, ctx)).toMatchObject({ failed: true });
  });

  it('an expression that backtracks for ever is stopped at its time limit, and the app goes on', async () => {
    const ctx = await project();
    await writeFile(join(ctx.roots[0]!, 'src', 'trap.txt'), `${'a'.repeat(40)}!\n`);
    const started = Date.now();
    const result = await createSearchTool({ timeoutMs: 500 }).handler(
      { id: 't1', name: 'search', input: { pattern: '^(a+)+$' } },
      ctx,
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result).toMatchObject({ failed: true });
    expect(result.content).toMatch(/stopped after 0\.5 s/);
  });

  it('is stopped with the turn', async () => {
    const controller = new AbortController();
    const ctx = await project(controller.signal);
    await writeFile(join(ctx.roots[0]!, 'src', 'trap.txt'), `${'a'.repeat(40)}!\n`);
    const pending = search.handler({ id: 't1', name: 'search', input: { pattern: '^(a+)+$' } }, ctx);
    setTimeout(() => controller.abort(), 200);
    expect((await pending).content).toMatch(/stopped/);
  });
});
