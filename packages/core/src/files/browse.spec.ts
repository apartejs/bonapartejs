/**
 * What the « Fichiers » pane shows (task 6.3): a folder of the perimeter,
 * listed as it is asked — folders first, then files, `.git` left out — and a
 * file read for its preview, as text, capped; never anything outside the
 * perimeter, a link that leaves it included (security rule 6).
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PathOutsidePerimeterError } from '../project/paths.js';
import { listEntries, readText } from './browse.js';

let dir: string;
let project: string;
let outside: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bp-browse-'));
  project = join(dir, 'spanwise');
  outside = join(dir, 'elsewhere');
  await mkdir(join(project, 'src', 'report'), { recursive: true });
  await mkdir(join(project, '.git'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(project, 'package.json'), '{}\n');
  await writeFile(join(project, 'AGENTS.md'), '# Agents\n');
  await writeFile(join(project, 'src', 'format.ts'), 'export const a = 1;\nexport const b = 2;\n');
  await writeFile(join(outside, 'secret.txt'), 'not yours\n');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const names = (entries: { name: string; kind: string }[]) => entries.map((entry) => `${entry.kind === 'dir' ? '/' : ''}${entry.name}`);

describe('browsing the perimeter', () => {
  it('lists a folder: folders first, then files, by name; .git left out', async () => {
    const top = await listEntries([project], null);
    expect(names(top)).toEqual(['/src', 'AGENTS.md', 'package.json']);
    expect(top[0]).toMatchObject({ display: 'src', kind: 'dir' });
    const src = await listEntries([project], top[0]!.path);
    expect(names(src)).toEqual(['/report', 'format.ts']);
    expect(src[1]!.display).toBe('src/format.ts');
  });

  it('with several folders, each is a folder at the top, named after it', async () => {
    const other = join(dir, 'docs');
    await mkdir(other);
    await writeFile(join(other, 'guide.md'), 'Guide\n');
    const top = await listEntries([project, other], null);
    expect(names(top)).toEqual(['/spanwise', '/docs']);
    expect(names(await listEntries([project, other], top[1]!.path))).toEqual(['guide.md']);
  });

  it('reads a file as text, capped, and says when it is not text', async () => {
    expect(await readText([project], join(project, 'src', 'format.ts'))).toEqual({
      kind: 'text',
      text: 'export const a = 1;\nexport const b = 2;\n',
      truncated: false,
    });
    await writeFile(join(project, 'big.txt'), 'x'.repeat(5000));
    expect(await readText([project], join(project, 'big.txt'), 1024)).toEqual({ kind: 'text', text: 'x'.repeat(1024), truncated: true });
    await writeFile(join(project, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    expect(await readText([project], join(project, 'image.png'))).toEqual({ kind: 'binary' });
  });

  it('never reads nor lists outside the perimeter, a link that leaves it included', async () => {
    await expect(readText([project], join(outside, 'secret.txt'))).rejects.toBeInstanceOf(PathOutsidePerimeterError);
    await expect(listEntries([project], outside)).rejects.toBeInstanceOf(PathOutsidePerimeterError);
    await symlink(outside, join(project, 'escape'), 'junction');
    await expect(readText([project], join(project, 'escape', 'secret.txt'))).rejects.toBeInstanceOf(PathOutsidePerimeterError);
    await expect(listEntries([project], join(project, 'escape'))).rejects.toBeInstanceOf(PathOutsidePerimeterError);
    // The link itself is listed (it is in the folder); it leads nowhere it may go.
    expect(names(await listEntries([project], null))).toContain('/escape');
  });
});
