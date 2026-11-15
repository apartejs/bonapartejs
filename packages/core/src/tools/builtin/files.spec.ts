/**
 * The tools that read and write the project's files. An expected failure — a
 * missing file, a path outside the perimeter, an ambiguous edit — is a result
 * the model reads and corrects itself from, never an exception. A write keeps
 * the original first (the turn's checkpoint).
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolContext, ToolHandler } from '../types.js';
import { editFile } from './edit-file.js';
import { listFiles } from './list-files.js';
import { readFileTool } from './read-file.js';
import { writeFileTool } from './write-file.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function project(): Promise<{ root: string; ctx: ToolContext; written: string[] }> {
  const root = await mkdtemp(join(tmpdir(), 'bp-tools-'));
  dirs.push(root);
  const written: string[] = [];
  const ctx: ToolContext = {
    conversationId: 'c1',
    roots: [root],
    nCtx: 8_192,
    signal: new AbortController().signal,
    beforeWrite: async (_absolute, shown) => void written.push(`before ${shown}`),
    afterWrite: async () => void written.push('after'),
  };
  return { root, ctx, written };
}

const call = (handler: ToolHandler, input: unknown, ctx: ToolContext) => handler({ id: 't1', name: 'x', input }, ctx);

describe('read_file', () => {
  it('reads a file of the project, whole or a slice of its lines', async () => {
    const { root, ctx } = await project();
    await writeFile(join(root, 'a.ts'), 'one\ntwo\nthree\n');
    expect(await call(readFileTool.handler, { path: 'a.ts' }, ctx)).toMatchObject({ content: 'one\ntwo\nthree\n' });
    expect(await call(readFileTool.handler, { path: 'a.ts', offset: 2, limit: 1 }, ctx)).toMatchObject({ content: 'two' });
  });

  it('says what is wrong: no path, no file, a path outside — naming the folders', async () => {
    const { root, ctx } = await project();
    expect(await call(readFileTool.handler, {}, ctx)).toMatchObject({ failed: true, content: 'Missing argument: path.' });
    expect(await call(readFileTool.handler, { path: 'none.ts' }, ctx)).toMatchObject({ failed: true, content: expect.stringMatching(/Cannot read file: none\.ts/) });
    const outside = await call(readFileTool.handler, { path: '../x.ts' }, ctx);
    expect(outside).toMatchObject({ failed: true });
    expect(outside.content).toContain(root);
  });
});

describe('list_files', () => {
  it('lists a folder, its folders marked, sorted', async () => {
    const { root, ctx } = await project();
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'b.ts'), '');
    await writeFile(join(root, 'a.ts'), '');
    expect(await call(listFiles.handler, {}, ctx)).toMatchObject({ content: 'a.ts\nb.ts\nsrc/' });
    expect(await call(listFiles.handler, { path: 'src' }, ctx)).toMatchObject({ content: '(empty folder)' });
  });
});

describe('edit_file', () => {
  it('replaces the one place the text stands, keeping the original first', async () => {
    const { root, ctx, written } = await project();
    await writeFile(join(root, 'a.ts'), 'const a = 1;\nconst b = 2;\n');
    const result = await call(editFile.handler, { path: 'a.ts', old_string: 'b = 2', new_string: 'b = 3' }, ctx);
    expect(result).toMatchObject({ content: 'Edited: a.ts' });
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('const a = 1;\nconst b = 3;\n');
    expect(written).toEqual(['before a.ts', 'after']);
  });

  it('touches nothing when the text is not there, or is there more than once', async () => {
    const { root, ctx, written } = await project();
    await writeFile(join(root, 'a.ts'), 'x\nx\n');
    expect(await call(editFile.handler, { path: 'a.ts', old_string: 'z', new_string: 'y' }, ctx)).toMatchObject({ failed: true });
    const twice = await call(editFile.handler, { path: 'a.ts', old_string: 'x', new_string: 'y' }, ctx);
    expect(twice).toMatchObject({ failed: true, content: expect.stringMatching(/2 occurrences/) });
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('x\nx\n');
    expect(written).toEqual([]);
  });

  it('a replacement with $ in it is written as it is', async () => {
    const { root, ctx } = await project();
    await writeFile(join(root, 'a.ts'), 'price\n');
    await call(editFile.handler, { path: 'a.ts', old_string: 'price', new_string: "$& costs $1 and $'" }, ctx);
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe("$& costs $1 and $'\n");
  });
});

describe('write_file', () => {
  it('writes a file, creating its folders, keeping the original first', async () => {
    const { root, ctx, written } = await project();
    expect(await call(writeFileTool.handler, { path: 'src/new/a.ts', content: 'hello' }, ctx)).toMatchObject({
      content: 'Wrote: src/new/a.ts (5 characters)',
    });
    expect(await readFile(join(root, 'src', 'new', 'a.ts'), 'utf8')).toBe('hello');
    expect(written).toEqual(['before src/new/a.ts', 'after']);
  });

  it('refuses a path outside, and writes nothing there', async () => {
    const { ctx, written } = await project();
    expect(await call(writeFileTool.handler, { path: '../evil.ts', content: 'x' }, ctx)).toMatchObject({ failed: true });
    expect(written).toEqual([]);
  });
});
