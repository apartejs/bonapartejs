/**
 * The pull request of a conversation's branch (task 6.8), through GitHub's
 * CLI — a fake one here: its state and its CI, read; none without the CLI;
 * one opened on the person's word.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ciOf, openPr, prStatus } from './pr.js';

const FAKE_GH = fileURLToPath(new URL('../testing/fake-gh.mjs', import.meta.url));
const gh = [process.execPath, FAKE_GH];

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
  delete process.env['FAKE_GH_STATE'];
  delete process.env['FAKE_GH_CALLS'];
});

async function state(pr?: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-gh-'));
  dirs.push(dir);
  const path = join(dir, 'state.json');
  await writeFile(path, JSON.stringify(pr ? { pr } : {}));
  process.env['FAKE_GH_STATE'] = path;
  process.env['FAKE_GH_CALLS'] = join(dir, 'calls.jsonl');
  return dir;
}

describe('the pull request of a branch', () => {
  it('reads its state and its CI', async () => {
    const dir = await state({
      number: 42,
      state: 'OPEN',
      url: 'https://github.com/example/project/pull/42',
      statusCheckRollup: [{ conclusion: 'SUCCESS', status: 'COMPLETED' }],
    });
    expect(await prStatus(gh, dir, 'bonaparte/heures')).toEqual({
      number: 42,
      state: 'open',
      url: 'https://github.com/example/project/pull/42',
      ci: 'success',
    });
    const calls = (await readFile(join(dir, 'calls.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as string[]);
    expect(calls[0]).toEqual(['pr', 'view', 'bonaparte/heures', '--json', 'number,state,url,statusCheckRollup']);
  });

  it('none when the branch has no pull request, or without the CLI', async () => {
    const dir = await state();
    expect(await prStatus(gh, dir, 'bonaparte/heures')).toBeNull();
    expect(await prStatus(null, dir, 'bonaparte/heures')).toBeNull();
    expect(await prStatus(['no-such-gh-command-here'], dir, 'bonaparte/heures')).toBeNull();
  });

  it('says the CI as a person reads it: failed if one failed, running if one runs, passed if all passed', () => {
    expect(ciOf([])).toBeNull();
    expect(ciOf([{ conclusion: 'SUCCESS' }, { conclusion: 'SKIPPED' }])).toBe('success');
    expect(ciOf([{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }])).toBe('pending');
    expect(ciOf([{ conclusion: 'FAILURE' }, { status: 'IN_PROGRESS' }])).toBe('failure');
    expect(ciOf([{ state: 'PENDING' }])).toBe('pending');
    expect(ciOf([{ state: 'ERROR' }])).toBe('failure');
  });

  it('opens one, its branch pushed first', async () => {
    const dir = await state();
    const pushed: string[][] = [];
    const opened = await openPr(gh, dir, 'bonaparte/heures', 'main', async (args) => {
      pushed.push(args);
      return { code: 0, stdout: '', stderr: '' };
    });
    expect(pushed).toEqual([['push', '-u', 'origin', 'bonaparte/heures']]);
    expect(opened).toMatchObject({ number: 42, state: 'open' });
  });
});
