/**
 * What an approval shows: the change, not the path. For `edit_file` and
 * `write_file`, the core computes the text before and after, and the unified
 * diff of them — with aparté's own diff (`@aparte/plugin-diff`, imported in
 * Node, without a DOM). An edit that will fail says why before anyone agrees.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { previewToolCall, unifiedDiff, type PreviewPaths } from './preview.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function project(): Promise<{ dir: string; paths: PreviewPaths }> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-preview-'));
  dirs.push(dir);
  const paths: PreviewPaths = {
    // Inside the project only: the perimeter (task 4.2) has the real rules.
    resolve: (requested) => (requested.startsWith('..') ? null : join(dir, requested)),
    display: (absolute) => relative(dir, absolute).replace(/\\/g, '/'),
  };
  return { dir, paths };
}

describe('unifiedDiff', () => {
  it("is aparté's unified diff: one hunk, its context, the lines taken out and put in", () => {
    expect(unifiedDiff('src/x.ts', 'a\nb\nc\n', 'a\nB\nc\n')).toBe(
      'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n',
    );
  });

  it('a new file comes from nothing', () => {
    expect(unifiedDiff('new.ts', null, 'one\ntwo\n')).toContain('--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,2 @@\n+one\n+two\n');
  });

  it('two texts alike have no hunk', () => {
    expect(unifiedDiff('y.ts', 'same\n', 'same\n')).not.toContain('@@');
  });

  it('a rewrite too big to compare line by line is summed up, not computed', () => {
    const before = Array.from({ length: 3_000 }, (_, n) => `old ${n}`).join('\n');
    const after = Array.from({ length: 3_000 }, (_, n) => `new ${n}`).join('\n');
    expect(unifiedDiff('big.ts', before, after)).toMatch(/3,?000 lines replaced by 3,?000/);
  });
});

describe('previewToolCall', () => {
  it('an edit shows the lines it changes, with the text before and after', async () => {
    const { dir, paths } = await project();
    await writeFile(join(dir, 'format.ts'), 'export const a = 1;\nexport const b = 2;\n');
    const preview = await previewToolCall(
      { name: 'edit_file', input: { path: 'format.ts', old_string: 'b = 2', new_string: 'b = 3' } },
      paths,
    );
    expect(preview).toMatchObject({ kind: 'diff', path: 'format.ts', before: 'export const a = 1;\nexport const b = 2;\n' });
    expect(preview?.kind === 'diff' ? preview.after : '').toContain('b = 3');
    expect(preview?.kind === 'diff' ? preview.diff : '').toContain('-export const b = 2;\n+export const b = 3;');
  });

  it('an edit that will fail says why: no file, no such text, or the text more than once', async () => {
    const { dir, paths } = await project();
    await writeFile(join(dir, 'twice.ts'), 'x\nx\n');
    const edit = (path: string, old_string: string) =>
      previewToolCall({ name: 'edit_file', input: { path, old_string, new_string: 'y' } }, paths);
    expect(await edit('absent.ts', 'x')).toEqual({ kind: 'fails', reason: 'missing', path: 'absent.ts' });
    expect(await edit('twice.ts', 'z')).toEqual({ kind: 'fails', reason: 'not-found', path: 'twice.ts' });
    expect(await edit('twice.ts', 'x')).toEqual({ kind: 'fails', reason: 'ambiguous', path: 'twice.ts', occurrences: 2 });
  });

  it('the card shows what edit_file will do to a CRLF file: the same match, the file’s endings kept (audit 2026-11-21, D4)', async () => {
    const { dir, paths } = await project();
    await writeFile(join(dir, 'crlf.ts'), 'a\r\nb\r\nc\r\n');
    const preview = await previewToolCall({ name: 'edit_file', input: { path: 'crlf.ts', old_string: 'a\nb', new_string: 'a\nB' } }, paths);
    expect(preview).toMatchObject({ kind: 'diff', after: 'a\r\nB\r\nc\r\n' });
  });

  it('a new file is shown whole; an existing one, only what changes', async () => {
    const { dir, paths } = await project();
    const created = await previewToolCall({ name: 'write_file', input: { path: 'new.ts', content: 'one\ntwo\n' } }, paths);
    expect(created).toMatchObject({ kind: 'diff', before: null, after: 'one\ntwo\n' });
    expect(created?.kind === 'diff' ? created.diff : '').toContain('--- /dev/null');
    await writeFile(join(dir, 'old.ts'), 'a\nb\n');
    const changed = await previewToolCall({ name: 'write_file', input: { path: 'old.ts', content: 'a\nc\n' } }, paths);
    expect(changed?.kind === 'diff' ? changed.diff : '').toContain('-b\n+c\n');
  });

  it('nothing to show for a path outside, an input that is not one, or another tool', async () => {
    const { paths } = await project();
    expect(await previewToolCall({ name: 'write_file', input: { path: '../outside.ts', content: 'x' } }, paths)).toBeUndefined();
    expect(await previewToolCall({ name: 'write_file', input: { path: 'a.ts' } }, paths)).toBeUndefined();
    expect(await previewToolCall({ name: 'write_file', input: 'not an object' }, paths)).toBeUndefined();
    expect(await previewToolCall({ name: 'read_file', input: { path: 'a.ts' } }, paths)).toBeUndefined();
  });
});
