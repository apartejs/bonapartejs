/**
 * What a tool tells the window, beside what the model reads: a few facts for
 * the line of its call (« Lu src/a.ts · 3 lignes », « Cherché hours ·
 * 2 résultats », « Lancé node · code 3 ») and, for a write, the change
 * behind the line. The model never reads them: they are the result's
 * `structuredContent`, which the families never render.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolContext, ToolHandler } from '../types.js';
import { editFile } from './edit-file.js';
import { listFiles } from './list-files.js';
import { readFileTool } from './read-file.js';
import { runCommand } from './run-command.js';
import { search } from './search.js';
import { writeFileTool } from './write-file.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
  dirs = [];
});

async function project(): Promise<{ root: string; ctx: ToolContext }> {
  const root = await mkdtemp(join(tmpdir(), 'bp-facts-'));
  dirs.push(root);
  return { root, ctx: { conversationId: 'c1', roots: [root], nCtx: 8_192, signal: new AbortController().signal } };
}

const call = (handler: ToolHandler, input: unknown, ctx: ToolContext) => handler({ id: 't1', name: 'x', input }, ctx);

describe('the facts of a call, for its line in the window', () => {
  it('read_file: how many lines it read', async () => {
    const { root, ctx } = await project();
    await writeFile(join(root, 'a.ts'), 'one\ntwo\nthree\n');
    expect((await call(readFileTool.handler, { path: 'a.ts' }, ctx)).structuredContent).toEqual({ lines: 3 });
    expect((await call(readFileTool.handler, { path: 'a.ts', offset: 2, limit: 1 }, ctx)).structuredContent).toEqual({ lines: 1 });
    await writeFile(join(root, 'empty.ts'), '');
    expect((await call(readFileTool.handler, { path: 'empty.ts' }, ctx)).structuredContent).toEqual({ lines: 0 });
  });

  it('list_files: how many entries the folder has', async () => {
    const { root, ctx } = await project();
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'a.ts'), '');
    expect((await call(listFiles.handler, {}, ctx)).structuredContent).toEqual({ entries: 2 });
    expect((await call(listFiles.handler, { path: 'src' }, ctx)).structuredContent).toEqual({ entries: 0 });
  });

  it('search: how many lines matched, and whether there were more', async () => {
    const { root, ctx } = await project();
    await writeFile(join(root, 'a.ts'), 'const hours = 1;\nconst minutes = 2;\nhours += 1;\n');
    expect((await call(search.handler, { pattern: 'hours' }, ctx)).structuredContent).toEqual({ matches: 2, more: false });
    expect((await call(search.handler, { pattern: 'nowhere' }, ctx)).structuredContent).toEqual({ matches: 0, more: false });
  });

  it('run_command: how the program ended', async () => {
    const { ctx } = await project();
    const ok = await call(runCommand.handler, { program: process.execPath, args: ['-e', '0'] }, ctx);
    expect(ok.structuredContent).toEqual({ exitCode: 0 });
    const failed = await call(runCommand.handler, { program: process.execPath, args: ['-e', 'process.exit(3)'] }, ctx);
    expect(failed.structuredContent).toEqual({ exitCode: 3 });
    const slow = await call(runCommand.handler, { program: process.execPath, args: ['-e', 'setTimeout(() => {}, 10000)'], timeoutMs: 200 }, ctx);
    expect(slow.structuredContent).toMatchObject({ stopped: 'time' });
  });

  it('edit_file: the change it made, as a unified diff', async () => {
    const { root, ctx } = await project();
    await writeFile(join(root, 'notes.txt'), 'first\nsecond\n');
    const result = await call(editFile.handler, { path: 'notes.txt', old_string: 'first', new_string: 'premier' }, ctx);
    const diff = (result.structuredContent as { diff: string }).diff;
    expect(diff).toContain('notes.txt');
    expect(diff).toContain('-first');
    expect(diff).toContain('+premier');
  });

  it('write_file: the change it made, and whether the file is new', async () => {
    const { root, ctx } = await project();
    const created = await call(writeFileTool.handler, { path: 'src/new.ts', content: 'export {};\n' }, ctx);
    expect(created.structuredContent).toMatchObject({ created: true, diff: expect.stringContaining('+export {};') });
    await writeFile(join(root, 'old.txt'), 'a\n');
    const replaced = await call(writeFileTool.handler, { path: 'old.txt', content: 'b\n' }, ctx);
    expect(replaced.structuredContent).toMatchObject({ created: false, diff: expect.stringContaining('-a') });
  });

  it('a failed call tells the window nothing more than the model reads', async () => {
    const { ctx } = await project();
    expect((await call(readFileTool.handler, { path: 'none.ts' }, ctx)).structuredContent).toBeUndefined();
  });
});
