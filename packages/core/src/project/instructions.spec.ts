/**
 * Project instructions (06 §2, must-have): the file every harness reads at
 * a repository's root, so the agent follows the repository's conventions.
 * bonaparte reads `.bonaparte/instructions.md`, else `AGENTS.md`, else
 * `CLAUDE.md` — the first found, per root — follows a file made only of
 * `@file` imports (a CLAUDE.md that says `@AGENTS.md`), and caps the text.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_INSTRUCTIONS_CHARS, readProjectInstructions } from './instructions.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

async function root(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-instr-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), content, 'utf8');
  }
  return dir;
}

describe('readProjectInstructions', () => {
  it('reads AGENTS.md and says where it came from', async () => {
    const dir = await root({ 'AGENTS.md': '# Rules\nUse pnpm.' });
    const found = await readProjectInstructions([dir]);
    expect(found?.sources).toEqual(['AGENTS.md']);
    expect(found?.text).toContain('Use pnpm.');
    expect(found?.text).toContain('AGENTS.md');
  });

  it('prefers .bonaparte/instructions.md, then AGENTS.md, then CLAUDE.md — one file per root', async () => {
    const all = await root({
      '.bonaparte/instructions.md': 'OURS',
      'AGENTS.md': 'AGENTS',
      'CLAUDE.md': 'CLAUDE',
    });
    expect((await readProjectInstructions([all]))?.text).toContain('OURS');
    expect((await readProjectInstructions([all]))?.text).not.toContain('AGENTS\n');

    const claudeOnly = await root({ 'CLAUDE.md': 'CLAUDE ONLY' });
    expect((await readProjectInstructions([claudeOnly]))?.sources).toEqual(['CLAUDE.md']);
  });

  it('follows a file made only of @imports — a CLAUDE.md that says @AGENTS.md', async () => {
    const dir = await root({ 'CLAUDE.md': '@AGENTS.md\n', 'AGENTS.md': 'THE REAL RULES' });
    // AGENTS.md comes first anyway; a .bonaparte file importing it shows the path.
    const viaOurs = await root({ '.bonaparte/instructions.md': '@../AGENTS.md', 'AGENTS.md': 'IMPORTED' });
    expect((await readProjectInstructions([dir]))?.text).toContain('THE REAL RULES');
    expect((await readProjectInstructions([viaOurs]))?.text).toContain('IMPORTED');
  });

  it('several roots: each labelled, in the project order', async () => {
    const a = await root({ 'AGENTS.md': 'FRONT RULES' });
    const b = await root({ 'AGENTS.md': 'BACK RULES' });
    const found = await readProjectInstructions([a, b]);
    expect(found?.sources).toHaveLength(2);
    expect(found!.text.indexOf('FRONT RULES')).toBeLessThan(found!.text.indexOf('BACK RULES'));
  });

  it('caps a huge file and says it was cut', async () => {
    const dir = await root({ 'AGENTS.md': 'x'.repeat(MAX_INSTRUCTIONS_CHARS * 2) });
    const found = await readProjectInstructions([dir]);
    expect(found!.text.length).toBeLessThan(MAX_INSTRUCTIONS_CHARS + 400);
    expect(found!.text).toMatch(/cut|truncated/i);
  });

  it('nothing to read: undefined — and an import outside the root is not followed', async () => {
    expect(await readProjectInstructions([])).toBeUndefined();
    const empty = await root({ 'README.md': 'not instructions' });
    expect(await readProjectInstructions([empty])).toBeUndefined();
    const escaping = await root({ 'AGENTS.md': '@../../../etc/passwd' });
    expect((await readProjectInstructions([escaping]))?.text ?? '').not.toContain('root:');
  });
});
