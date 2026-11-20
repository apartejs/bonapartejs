/**
 * The tools that read and write the project's files. An expected failure — a
 * missing file, a path outside the perimeter, an ambiguous edit — is a result
 * the model reads and corrects itself from, never an exception. A write keeps
 * the original first (the turn's checkpoint).
 */

import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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

  it('a file too long for the context is cut after a whole line, saying which lines were shown and where to go on (audit 2026-11-21, D5)', async () => {
    const { root, ctx } = await project();
    const lines = Array.from({ length: 1_000 }, (_, n) => `line ${String(n + 1).padStart(4, '0')} ${'.'.repeat(30)}`);
    await writeFile(join(root, 'long.txt'), `${lines.join('\n')}\n`);
    const whole = await call(readFileTool.handler, { path: 'long.txt' }, ctx);
    expect(whole.content.length).toBeLessThanOrEqual(6_144);
    const said = /\[Lines 1–(\d+) of 1000 shown\. Read the rest with offset=(\d+)\.\]$/.exec(whole.content);
    expect(said).not.toBeNull();
    const last = Number(said![1]);
    expect(Number(said![2])).toBe(last + 1);
    expect(whole.content).toContain(`${lines[last - 1]}\n[Lines`);
    expect(whole.content).not.toContain(lines[last]!);
    // From an offset: the lines it shows are said from there.
    const later = await call(readFileTool.handler, { path: 'long.txt', offset: 500 }, ctx);
    expect(later.content.startsWith(lines[499]!)).toBe(true);
    expect(later.content).toMatch(/\[Lines 500–\d+ of 1000 shown\. Read the rest with offset=\d+\.\]$/);
  });

  it('one line longer than the view is said cut, never shown whole: search reaches the rest (review of 2026-11-21)', async () => {
    const { root, ctx } = await project();
    await writeFile(join(root, 'bundle.min.js'), `${'x'.repeat(20_000)}\n`);
    const read = await call(readFileTool.handler, { path: 'bundle.min.js' }, ctx);
    expect(read.content.length).toBeLessThanOrEqual(6_144);
    expect(read.content).toMatch(/\[Line 1 is longer than this view \(20000 characters\): only its first \d+ are shown\. Use search to find what you need in it\.\]$/);
    expect(read.content).not.toMatch(/offset=/);
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
    expect(twice).toMatchObject({ failed: true, content: expect.stringMatching(/occurs 2 times/) });
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('x\nx\n');
    expect(written).toEqual([]);
  });

  it('a short old_string in a big file is answered at once: only the lines it names are counted (review of 2026-11-21)', async () => {
    const { root, ctx } = await project();
    await writeFile(join(root, 'big.ts'), '{\n}\n'.repeat(30_000));
    const started = performance.now();
    const answer = await call(editFile.handler, { path: 'big.ts', old_string: '}', new_string: ']' }, ctx);
    expect(answer).toMatchObject({ failed: true, content: expect.stringMatching(/occurs 30000 times/) });
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('a CRLF file is edited from an old_string written with \\n, and keeps its CRLF (audit 2026-11-21, D4)', async () => {
    const { root, ctx } = await project();
    await writeFile(join(root, 'a.ts'), 'function f() {\r\n  return 1;\r\n}\r\nconst z = 0;\r\n');
    const result = await call(
      editFile.handler,
      { path: 'a.ts', old_string: 'function f() {\n  return 1;\n}', new_string: 'function f() {\n  const x = 2;\n  return x;\n}' },
      ctx,
    );
    expect(result).toMatchObject({ content: 'Edited: a.ts' });
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('function f() {\r\n  const x = 2;\r\n  return x;\r\n}\r\nconst z = 0;\r\n');
    // One line of a CRLF file, replaced by two: the new line takes the file's ending too.
    await call(editFile.handler, { path: 'a.ts', old_string: 'const z = 0;', new_string: 'const z = 0;\nconst w = 1;' }, ctx);
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('function f() {\r\n  const x = 2;\r\n  return x;\r\n}\r\nconst z = 0;\r\nconst w = 1;\r\n');
  });

  it('an LF file stays LF, whatever endings new_string came with', async () => {
    const { root, ctx } = await project();
    await writeFile(join(root, 'a.ts'), 'a\nb\nc\n');
    await call(editFile.handler, { path: 'a.ts', old_string: 'a\r\nb', new_string: 'a\r\nB\r\nb' }, ctx);
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('a\nB\nb\nc\n');
  });

  it('two places that differ only by their line endings are still two', async () => {
    const { root, ctx } = await project();
    await writeFile(join(root, 'a.ts'), 'x\r\ny\nx\ny\n');
    const twice = await call(editFile.handler, { path: 'a.ts', old_string: 'x\ny', new_string: 'z' }, ctx);
    expect(twice).toMatchObject({ failed: true, content: expect.stringMatching(/2 times/) });
  });

  it('text not found says what to do, and where the near match is when only whitespace differs', async () => {
    const { root, ctx } = await project();
    await writeFile(join(root, 'a.ts'), 'const a = 1;\nif (a) {\n    call(a);\n}\n');
    const spaced = await call(editFile.handler, { path: 'a.ts', old_string: 'if (a) {\n  call(a);\n}', new_string: 'x' }, ctx);
    expect(spaced).toMatchObject({ failed: true });
    expect(spaced.content).toMatch(/old_string was not found in a\.ts; the file is unchanged\. Read the file again and copy the text exactly, indentation included\./);
    expect(spaced.content).toMatch(/whitespace.*line 2/i);
    const close = await call(editFile.handler, { path: 'a.ts', old_string: '    cal(a);', new_string: 'x' }, ctx);
    expect(close.content).toMatch(/closest.*line 3/i);
    const none = await call(editFile.handler, { path: 'a.ts', old_string: 'zzzzqqqq', new_string: 'x' }, ctx);
    expect(none.content).not.toMatch(/closest|whitespace/i);
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('const a = 1;\nif (a) {\n    call(a);\n}\n');
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

  it('a CRLF file rewritten with LF keeps its CRLF; a new file is written as given (audit 2026-11-21, D4)', async () => {
    const { root, ctx } = await project();
    await writeFile(join(root, 'a.ts'), 'one\r\ntwo\r\n');
    await call(writeFileTool.handler, { path: 'a.ts', content: 'one\nTWO\nthree\n' }, ctx);
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('one\r\nTWO\r\nthree\r\n');
    await call(writeFileTool.handler, { path: 'b.ts', content: 'x\ny\n' }, ctx);
    expect(await readFile(join(root, 'b.ts'), 'utf8')).toBe('x\ny\n');
  });

  it('writes outside the project once the person allowed that very call, never otherwise', async () => {
    const { root, ctx } = await project();
    const beside = join(root, '..', `bp-beside-${Date.now()}.txt`);
    expect(await call(writeFileTool.handler, { path: beside, content: 'x' }, ctx)).toMatchObject({ failed: true });
    const allowed = await call(writeFileTool.handler, { path: beside, content: 'allowed' }, { ...ctx, granted: true });
    expect(allowed.failed).toBeUndefined();
    expect(await readFile(beside, 'utf8')).toBe('allowed');
    await rm(beside, { force: true });
  });

  it('an allowed write outside the project still goes where shown when a folder above the project is a link (a short name, /var on macOS)', async () => {
    const real = await mkdtemp(join(tmpdir(), 'bp-real-'));
    dirs.push(real);
    const reached = join(tmpdir(), `bp-reached-${Date.now()}`);
    try {
      await symlink(real, reached, 'junction');
    } catch {
      return;
    }
    dirs.push(reached);
    await mkdir(join(real, 'project'));
    const ctx: ToolContext = { conversationId: 'c1', roots: [join(reached, 'project')], nCtx: 8_192, signal: new AbortController().signal, granted: true };
    const result = await call(writeFileTool.handler, { path: '../beside.txt', content: 'shown' }, ctx);
    expect(result.failed).toBeUndefined();
    expect(await readFile(join(real, 'beside.txt'), 'utf8')).toBe('shown');
  });

  it('an allowed write outside the project never goes through a link to somewhere else than the card showed', async () => {
    const { root, ctx } = await project();
    const elsewhere = await mkdtemp(join(tmpdir(), 'bp-elsewhere-'));
    dirs.push(elsewhere);
    const beside = join(root, '..', `bp-beside-link-${Date.now()}`);
    try {
      await symlink(elsewhere, beside, 'junction');
    } catch {
      return;
    }
    dirs.push(beside);
    const result = await call(writeFileTool.handler, { path: join(beside, 'x.txt'), content: 'x' }, { ...ctx, granted: true });
    expect(result).toMatchObject({ failed: true });
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it('refuses a path outside, and writes nothing there', async () => {
    const { ctx, written } = await project();
    expect(await call(writeFileTool.handler, { path: '../evil.ts', content: 'x' }, ctx)).toMatchObject({ failed: true });
    expect(written).toEqual([]);
  });
});

describe('what the disarming added never reaches the person\u2019s files (review of phase 13)', () => {
  // A token the model read was written with a zero-width space after its first character: what it writes back is
  // the text as it was.
  const ZW = '\u200b';

  it('write_file writes the tokens as they were', async () => {
    const { root, ctx } = await project();
    await call(writeFileTool.handler, { path: 'tok.json', content: `{"eos": "<${ZW}/s>", "inst": "[${ZW}INST]", "chat": "<${ZW}|im_end|>"}` }, ctx);
    expect(await readFile(join(root, 'tok.json'), 'utf8')).toBe('{"eos": "</s>", "inst": "[INST]", "chat": "<|im_end|>"}');
  });

  it('edit_file finds the text the model copied, and writes it back as it was', async () => {
    const { root, ctx } = await project();
    await writeFile(join(root, 'p.html'), '<p>a <s>b</s></p>');
    const result = await call(editFile.handler, { path: 'p.html', old_string: `<${ZW}s>b<${ZW}/s>`, new_string: `<${ZW}s>c<${ZW}/s>` }, ctx);
    expect(result).not.toMatchObject({ failed: true });
    expect(await readFile(join(root, 'p.html'), 'utf8')).toBe('<p>a <s>c</s></p>');
  });
});
