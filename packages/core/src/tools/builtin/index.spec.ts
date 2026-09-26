import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolContext, ToolResult } from '../types.js';
import { builtinTools, MAX_TOOL_OUTPUT_CHARS } from './index.js';

let roots: string[] = [];

async function project(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bp-tools-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content, 'utf8');
  }
  return root;
}

afterEach(async () => {
  // On Windows, a killed process (timeout test) keeps its cwd locked for
  // a few moments: we retry, and a cleanup failure must never fail a test.
  await Promise.all(
    roots.map((r) =>
      rm(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
        () => undefined,
      ),
    ),
  );
  roots = [];
});

function ctx(...roots: string[]): ToolContext {
  return { roots, signal: new AbortController().signal };
}

async function call(
  name: string,
  args: Record<string, unknown>,
  projectRoot: string,
): Promise<ToolResult> {
  const tool = builtinTools().find((t) => t.def.name === name);
  if (!tool) throw new Error(`tool missing from the kit: ${name}`);
  return tool.handler(args, ctx(projectRoot));
}

describe('tool kit', () => {
  it('exposes the expected tools with a declared effect', () => {
    const byName = new Map(builtinTools().map((t) => [t.def.name, t.def]));
    expect([...byName.keys()].sort()).toEqual([
      'edit_file',
      'grep_files',
      'list_dir',
      'read_file',
      'run_shell',
      'write_file',
    ]);
    expect(byName.get('read_file')!.effect).toBe('read');
    expect(byName.get('write_file')!.effect).toBe('write');
    expect(byName.get('edit_file')!.effect).toBe('write');
    expect(byName.get('run_shell')!.effect).toBe('execute');
  });

  it('each tool describes its arguments as an object JSON Schema', () => {
    for (const { def } of builtinTools()) {
      expect(def.inputSchema['type']).toBe('object');
      expect(def.description.length).toBeGreaterThan(10);
    }
  });
});

describe('read_file', () => {
  it('reads a file from the project', async () => {
    const root = await project({ 'src/a.ts': 'const a = 1;' });
    const res = await call('read_file', { path: 'src/a.ts' }, root);
    expect(res.ok).toBe(true);
    expect(res.content).toContain('const a = 1;');
  });

  it('reports a missing file without throwing', async () => {
    const root = await project();
    const res = await call('read_file', { path: 'fantome.ts' }, root);
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/fantome\.ts/);
  });

  it('cleanly refuses to leave the project', async () => {
    const root = await project();
    const res = await call('read_file', { path: '../secrets.txt' }, root);
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/project/i);
  });

  it('truncates an oversized file while flagging it', async () => {
    const root = await project({ 'big.txt': 'x'.repeat(MAX_TOOL_OUTPUT_CHARS + 500) });
    const res = await call('read_file', { path: 'big.txt' }, root);
    expect(res.ok).toBe(true);
    expect(res.content.length).toBeLessThan(MAX_TOOL_OUTPUT_CHARS + 300);
    expect(res.content).toMatch(/truncated/i);
  });

  it('reads a slice with offset and limit', async () => {
    const root = await project({ 'l.txt': 'l1\nl2\nl3\nl4\nl5' });
    const res = await call('read_file', { path: 'l.txt', offset: 2, limit: 2 }, root);
    expect(res.content).toContain('l2');
    expect(res.content).toContain('l3');
    expect(res.content).not.toContain('l5');
  });
});

describe('write_file', () => {
  it('writes and creates missing directories', async () => {
    const root = await project();
    const res = await call(
      'write_file',
      { path: 'a/b/c.txt', content: 'hi' },
      root,
    );
    expect(res.ok).toBe(true);
    expect(await readFile(join(root, 'a/b/c.txt'), 'utf8')).toBe('hi');
  });

  it('overwrites an existing file', async () => {
    const root = await project({ 'a.txt': 'before' });
    await call('write_file', { path: 'a.txt', content: 'after' }, root);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('after');
  });

  it('refuses to write outside the project', async () => {
    const root = await project();
    const res = await call(
      'write_file',
      { path: '../escape.txt', content: 'x' },
      root,
    );
    expect(res.ok).toBe(false);
  });

  it('requires string-typed content', async () => {
    const root = await project();
    const res = await call('write_file', { path: 'a.txt', content: 42 }, root);
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/content/);
  });
});

describe('edit_file', () => {
  it('replaces a unique occurrence', async () => {
    const root = await project({ 'a.ts': 'let x = 1;\nlet y = 2;' });
    const res = await call(
      'edit_file',
      { path: 'a.ts', old_string: 'let x = 1;', new_string: 'const x = 1;' },
      root,
    );
    expect(res.ok).toBe(true);
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('const x = 1;\nlet y = 2;');
  });

  it('refuses if the pattern is absent', async () => {
    const root = await project({ 'a.ts': 'rien' });
    const res = await call(
      'edit_file',
      { path: 'a.ts', old_string: 'missing', new_string: 'x' },
      root,
    );
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/not found|no occurrence/i);
  });

  it('refuses if the pattern is ambiguous (multiple occurrences)', async () => {
    const root = await project({ 'a.ts': 'dup\ndup' });
    const res = await call(
      'edit_file',
      { path: 'a.ts', old_string: 'dup', new_string: 'x' },
      root,
    );
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/2/);
    // The file must not have moved.
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('dup\ndup');
  });
});

describe('list_dir', () => {
  it('lists the contents, distinguishing directories', async () => {
    const root = await project({ 'src/a.ts': '', 'README.md': '' });
    const res = await call('list_dir', {}, root);
    expect(res.ok).toBe(true);
    expect(res.content).toContain('src/');
    expect(res.content).toContain('README.md');
  });

  it('reports a missing directory', async () => {
    const root = await project();
    const res = await call('list_dir', { path: 'nowhere' }, root);
    expect(res.ok).toBe(false);
  });
});

describe('grep_files', () => {
  it('finds matching lines with file and line number', async () => {
    const root = await project({
      'a.ts': 'const target = 1;\nother',
      'b.ts': 'rien',
    });
    const res = await call('grep_files', { pattern: 'target' }, root);
    expect(res.ok).toBe(true);
    expect(res.content).toMatch(/a\.ts:1/);
    expect(res.content).not.toContain('b.ts');
  });

  it('accepts a regular expression', async () => {
    const root = await project({ 'a.ts': 'foo123bar' });
    const res = await call('grep_files', { pattern: 'foo\\d+bar' }, root);
    expect(res.ok).toBe(true);
    expect(res.content).toContain('a.ts');
  });

  it('reports an invalid regex without throwing', async () => {
    const root = await project({ 'a.ts': 'x' });
    const res = await call('grep_files', { pattern: '([' }, root);
    expect(res.ok).toBe(false);
  });

  it('clearly states when nothing matches', async () => {
    const root = await project({ 'a.ts': 'x' });
    const res = await call('grep_files', { pattern: 'zzz' }, root);
    expect(res.ok).toBe(true);
    expect(res.content).toMatch(/no match/i);
  });
});

describe('run_shell', () => {
  it('executes a command and captures its output', async () => {
    const root = await project();
    const res = await call('run_shell', { command: 'echo bonaparte' }, root);
    expect(res.ok).toBe(true);
    expect(res.content).toContain('bonaparte');
  });

  it('reports a non-zero exit code without throwing', async () => {
    const root = await project();
    const res = await call('run_shell', { command: 'exit 3' }, root);
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/3/);
  });

  it('executes at the project root', async () => {
    const root = await project({ 'marker.txt': '' });
    const command = process.platform === 'win32' ? 'dir /b' : 'ls';
    const res = await call('run_shell', { command }, root);
    expect(res.content).toContain('marker.txt');
  });

  it('interrupts a command that exceeds the deadline', async () => {
    const root = await project();
    const command =
      process.platform === 'win32'
        ? 'ping -n 20 127.0.0.1 > nul'
        : 'sleep 20';
    const res = await call('run_shell', { command, timeout_ms: 300 }, root);
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/timeout/i);
  }, 15_000);

  it('requires a non-empty command', async () => {
    const root = await project();
    const res = await call('run_shell', { command: '   ' }, root);
    expect(res.ok).toBe(false);
  });
});

describe('with no project open', () => {
  it('the tools still exist, confined to the home folder (Q-26)', async () => {
    // The project is the tools' PERIMETER, not their condition of
    // existence: discussing with no folder must not deprive the agent of
    // the ability to read — but "no project" is not the whole machine.
    const home = await project({ 'note.txt': 'content in the home folder' });
    const saved = { HOME: process.env['HOME'], USERPROFILE: process.env['USERPROFILE'] };
    process.env['HOME'] = home;
    process.env['USERPROFILE'] = home;
    try {
      const read = builtinTools().find((t) => t.def.name === 'read_file')!;
      const ctx = { roots: [], signal: new AbortController().signal };

      const inside = await read.handler({ path: join(home, 'note.txt') }, ctx);
      expect(inside.ok).toBe(true);
      expect(inside.content).toContain('content in the home folder');

      const outside = await read.handler({ path: join(home, '..', 'elsewhere.txt') }, ctx);
      expect(outside.ok).toBe(false);
      expect(outside.content).toMatch(/home folder/);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
