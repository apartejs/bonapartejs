/**
 * Project instructions: the file every harness reads at
 * a repository's root, so the agent follows the repository's conventions.
 * bonaparte reads `.bonaparte/instructions.md`, else `AGENTS.md`, else
 * `CLAUDE.md` — the first found, per root — follows a file made only of
 * `@file` imports (a CLAUDE.md that says `@AGENTS.md`), and cuts the text to
 * the context it is frozen for, saying where to read on.
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cutInstructions, instructionsBudget, MAX_INSTRUCTIONS_CHARS, readProjectInstructions, sameInstructions } from './instructions.js';

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

  it('labels an imported file by its own name: the cut names the file to read on', async () => {
    const dir = await root({ '.bonaparte/instructions.md': '@../docs/RULES.md\n', 'docs/RULES.md': 'THE REAL RULES' });
    const found = await readProjectInstructions([dir]);
    expect(found?.text).toBe('(from docs/RULES.md)\nTHE REAL RULES');
    expect(found?.sources).toEqual(['.bonaparte/instructions.md']);
  });

  it('several roots: each labelled, in the project order', async () => {
    const a = await root({ 'AGENTS.md': 'FRONT RULES' });
    const b = await root({ 'AGENTS.md': 'BACK RULES' });
    const found = await readProjectInstructions([a, b]);
    expect(found?.sources).toHaveLength(2);
    expect(found!.text.indexOf('FRONT RULES')).toBeLessThan(found!.text.indexOf('BACK RULES'));
  });

  it('reads the whole file: the cut is the context’s, made when the text is frozen (audit 2026-11-21, I2)', async () => {
    const dir = await root({ 'AGENTS.md': 'x'.repeat(MAX_INSTRUCTIONS_CHARS * 2) });
    const found = await readProjectInstructions([dir]);
    expect(found!.text.length).toBeGreaterThan(MAX_INSTRUCTIONS_CHARS * 2);
  });

  it('nothing to read: undefined — and an import outside the root is not followed', async () => {
    expect(await readProjectInstructions([])).toBeUndefined();
    const empty = await root({ 'README.md': 'not instructions' });
    expect(await readProjectInstructions([empty])).toBeUndefined();
    const escaping = await root({ 'AGENTS.md': '@../../../etc/passwd' });
    expect((await readProjectInstructions([escaping]))?.text ?? '').not.toContain('root:');
  });

  it('never reads a file that a link takes out of the project: the instructions stay inside the perimeter', async () => {
    const project = await root({ 'AGENTS.md': 'Inside.\n' });
    const outside = await root({ 'instructions.md': 'A secret from elsewhere.\n' });
    try {
      await symlink(outside, join(project, '.bonaparte'), 'junction');
    } catch {
      return;
    }
    const read = await readProjectInstructions([project]);
    expect(read?.text).not.toContain('A secret from elsewhere.');
    expect(read?.text).toContain('Inside.');
  });
});

describe('the instructions on a small context (audit 2026-11-21, I2)', () => {
  it('take about 12 % of the context, never more than the cap', () => {
    expect(instructionsBudget(8192)).toBeGreaterThan(3800);
    expect(instructionsBudget(8192)).toBeLessThan(4100);
    expect(instructionsBudget(16_384)).toBe(2 * instructionsBudget(8192));
    expect(instructionsBudget(1_000_000)).toBe(MAX_INSTRUCTIONS_CHARS);
    // A context not known is taken as a small one, never as an infinite one (review of round 2, 3).
    expect(instructionsBudget(Number.POSITIVE_INFINITY)).toBe(instructionsBudget(8192));
    expect(instructionsBudget(0)).toBe(instructionsBudget(8192));
  });

  it('cut after a whole line, the note naming the file and the line to read on from', async () => {
    const lines = Array.from({ length: 800 }, (_, index) => `Rule ${index + 1}: keep it short.`);
    const dir = await root({ 'AGENTS.md': lines.join('\n') });
    const text = (await readProjectInstructions([dir]))!.text;
    const cut = cutInstructions(text, 2000);
    expect(cut.length).toBeLessThanOrEqual(2000);
    const note = /\n\[AGENTS\.md is cut after line (\d+): read_file AGENTS\.md with offset (\d+) for the rest\]$/.exec(cut);
    expect(note).not.toBeNull();
    const [, last, next] = note!;
    expect(Number(next)).toBe(Number(last) + 1);
    expect(cut).toContain(`\nRule ${last}: keep it short.\n`);
    expect(cut).not.toContain(`Rule ${next}:`);
    // What fits is left whole.
    expect(cutInstructions(text, text.length)).toBe(text);
  });

  it('with several folders, the note and the files not shown name paths read_file opens: the first folder’s relative, the others absolute (review of round 2, 6)', async () => {
    const web = await root({ 'AGENTS.md': Array.from({ length: 400 }, (_, index) => `Web rule ${index + 1}.`).join('\n') });
    const api = await root({ 'AGENTS.md': 'API RULES' });
    const cut = cutInstructions((await readProjectInstructions([web, api]))!.text, 1500);
    // Relative paths resolve from the first folder: its file is « AGENTS.md » there, never « <folder>/AGENTS.md ».
    expect(cut).toMatch(/\[AGENTS\.md is cut after line \d+: read_file AGENTS\.md with offset \d+ for the rest\]/);
    const other = join(api, 'AGENTS.md').replace(/\\/g, '/');
    expect(cut).toContain(`[Not shown: ${other} — read with read_file when you need them]`);
    // Past the cut, the second folder's file is named by its absolute path in its label too.
    const whole = (await readProjectInstructions([web, api]))!.text;
    expect(whole).toContain(`(from ${other})\nAPI RULES`);
  });

  it('counts the lines as the file does: blank lines at its start included (review of round 2, 6)', async () => {
    const dir = await root({ 'AGENTS.md': '\n\n\n' + Array.from({ length: 400 }, (_, index) => `Line ${index + 4}.`).join('\n') });
    const cut = cutInstructions((await readProjectInstructions([dir]))!.text, 1500);
    const [, last] = /is cut after line (\d+):/.exec(cut)!;
    // The file's line N holds « Line N. »: the offset given is where the file goes on.
    expect(cut).toContain(`\nLine ${last}.\n[AGENTS.md is cut`);
  });

  it('a file of a second folder past the cut is named, never dropped in silence', async () => {
    const a = await root({ 'AGENTS.md': 'A rule.\n'.repeat(400) });
    const b = await root({ 'AGENTS.md': 'BACK RULES' });
    const text = (await readProjectInstructions([a, b]))!.text;
    const cut = cutInstructions(text, 1500);
    expect(cut.length).toBeLessThanOrEqual(1500);
    expect(cut).not.toContain('BACK RULES');
    expect(cut).toMatch(/Not shown: .*AGENTS\.md/);
  });

  it('a conversation frozen with the old cut, or the old label, has the same instructions: nothing told again', () => {
    const full = '(from AGENTS.md)\n' + 'Rule.\n'.repeat(5000);
    const legacy =
      ('(from CLAUDE.md)\n' + 'Rule.\n'.repeat(5000)).slice(0, 16_000) +
      '\n\n[instructions cut here: the file continues — read it with read_file when you need the rest]';
    expect(sameInstructions(legacy, full)).toBe(true);
    expect(sameInstructions('(from CLAUDE.md)\nTHE RULES', '(from AGENTS.md)\nTHE RULES')).toBe(true);
    expect(sameInstructions(full, full)).toBe(true);
    expect(sameInstructions('(from AGENTS.md)\nOld rule.', '(from AGENTS.md)\nNew rule.')).toBe(false);
    expect(sameInstructions('', '(from AGENTS.md)\nNew rule.')).toBe(false);
    expect(sameInstructions('(from AGENTS.md)\nOld rule.', '')).toBe(false);
  });
});
