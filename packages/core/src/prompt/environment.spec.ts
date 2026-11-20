/**
 * What the model is told of where it works, frozen in the conversation's own turn (audit 2026-11-21, I1): the
 * date, and in a git repository its branch and what is not committed — never in the shared turn, whose seed
 * every conversation of the machine reads.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from '../git/git.js';
import { platformName, readEnvironment, renderEnvironment } from './environment.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
});

describe('the environment told to the model', () => {
  it('names the platform as people say it', () => {
    expect(platformName('win32')).toBe('Windows');
    expect(platformName('darwin')).toBe('macOS');
    expect(platformName('linux')).toBe('Linux');
  });

  it('says the date, and nothing of git outside a repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bp-env-'));
    dirs.push(dir);
    const environment = await readEnvironment(dir, new Date(2026, 10, 20, 9, 30));
    expect(environment).toEqual({ date: '2026-11-20' });
    expect(renderEnvironment(environment)).toBe('Today is 2026-11-20.');
  });

  it('in a repository: its branch and a short status of what is not committed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bp-env-git-'));
    dirs.push(dir);
    await git(['init', '-q', '-b', 'trunk'], dir);
    await git(['config', 'core.autocrlf', 'false'], dir);
    await writeFile(join(dir, 'notes.txt'), 'a\n');
    const environment = await readEnvironment(dir, new Date(2026, 10, 20));
    expect(environment.git).toEqual({ branch: 'trunk', status: ['?? notes.txt'] });
    expect(renderEnvironment(environment)).toBe('Today is 2026-11-20.\nGit: branch trunk, 1 file not committed:\n?? notes.txt');
  });

  it('a clean repository says so; a long status is cut, the rest counted', () => {
    expect(renderEnvironment({ date: '2026-11-20', git: { branch: 'main', status: [] } })).toBe(
      'Today is 2026-11-20.\nGit: branch main, nothing to commit.',
    );
    const status = Array.from({ length: 25 }, (_, index) => ` M src/file-${index}.ts`);
    const text = renderEnvironment({ date: '2026-11-20', git: { branch: '', status } });
    expect(text).toContain('Git: detached HEAD, 25 files not committed:');
    expect(text).toContain(' M src/file-19.ts');
    expect(text).not.toContain('file-20.ts');
    expect(text.endsWith('… and 5 more.')).toBe(true);
  });
});
