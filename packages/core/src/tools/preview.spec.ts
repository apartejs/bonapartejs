/**
 * What an approval shows (06 §2, must-have): the change, not only the
 * path. An edit or a write is previewed as a unified diff against the file
 * on disk — the thing the person is being asked to sign.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { previewToolCall, unifiedDiff } from './preview.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

async function repo(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-preview-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content, 'utf8');
  return dir;
}

const lines = (n: number, prefix = 'line'): string =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n';

describe('previewToolCall — edit_file', () => {
  it('shows the replaced lines with their context, as a unified hunk', async () => {
    const root = await repo({ 'a.ts': lines(10) });
    const preview = await previewToolCall(
      'edit_file',
      { path: 'a.ts', old_string: 'line 5', new_string: 'LINE FIVE\nextra' },
      [root],
    );
    expect(preview).toBe(
      [
        '--- a.ts',
        '+++ a.ts',
        '@@ -2,7 +2,8 @@',
        ' line 2',
        ' line 3',
        ' line 4',
        '-line 5',
        '+LINE FIVE',
        '+extra',
        ' line 6',
        ' line 7',
        ' line 8',
      ].join('\n'),
    );
  });

  it('a pattern that is not in the file, or twice: says so rather than inventing a diff', async () => {
    const root = await repo({ 'a.ts': 'dup\ndup\n' });
    expect(await previewToolCall('edit_file', { path: 'a.ts', old_string: 'nope', new_string: 'x' }, [root])).toMatch(
      /not found/i,
    );
    expect(await previewToolCall('edit_file', { path: 'a.ts', old_string: 'dup', new_string: 'x' }, [root])).toMatch(
      /2 occurrences/,
    );
  });
});

describe('previewToolCall — write_file', () => {
  it('a new file: every line added, under a "new file" header', async () => {
    const root = await repo({});
    const preview = await previewToolCall('write_file', { path: 'new.ts', content: 'a\nb\n' }, [root]);
    expect(preview).toBe(['--- /dev/null', '+++ new.ts', '@@ -0,0 +1,2 @@', '+a', '+b'].join('\n'));
  });

  it('an existing file: only what changes, with context', async () => {
    const root = await repo({ 'c.ts': lines(20) });
    const next = lines(20).replace('line 10\n', 'line ten\n');
    const preview = await previewToolCall('write_file', { path: 'c.ts', content: next }, [root]);
    expect(preview).toContain('@@ -7,7 +7,7 @@');
    expect(preview).toContain('-line 10');
    expect(preview).toContain('+line ten');
    expect(preview).not.toContain('line 1\n');
  });

  it('a huge rewrite is summarised, never dumped', async () => {
    const root = await repo({ 'big.txt': lines(5000, 'old') });
    const preview = await previewToolCall('write_file', { path: 'big.txt', content: lines(5000, 'new') }, [root]);
    expect(preview!.length).toBeLessThan(20_000);
    expect(preview).toMatch(/5000 lines/);
  });

  it('a path outside the project gives no preview: the tool will refuse it', async () => {
    const root = await repo({});
    expect(await previewToolCall('write_file', { path: '../../escape.txt', content: 'x' }, [root])).toBeUndefined();
  });

  it('other tools have no preview', async () => {
    expect(await previewToolCall('run_shell', { command: 'ls' }, [])).toBeUndefined();
  });
});

describe('unifiedDiff', () => {
  it('two separate changes make two hunks', () => {
    const before = lines(30);
    const after = before.replace('line 3\n', 'line three\n').replace('line 27\n', 'line twenty-seven\n');
    const diff = unifiedDiff('f', 'f', before, after);
    expect(diff.match(/^@@/gm)).toHaveLength(2);
  });

  it('identical texts: no hunk', () => {
    expect(unifiedDiff('f', 'f', 'a\n', 'a\n')).not.toContain('@@');
  });
});
