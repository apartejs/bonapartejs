/**
 * The rules « always allow » remembered, per project (and for the
 * conversations without one), kept on disk. What is written by hand — or by
 * anything but the app — is read again through the same rule: a rule that
 * could not have been remembered is dropped.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GrantStore } from './grants.js';
import type { AllowRule } from './rules.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-grants-'));
  dirs.push(dir);
  return dir;
}

const TEST: AllowRule = { tool: 'run_command', program: 'pnpm', args: ['test'] };
const FETCH: AllowRule = { tool: 'web_fetch' };

describe('GrantStore', () => {
  it('keeps the rules of each project, and of the conversations without one, across a restart', async () => {
    const dir = await folder();
    const store = new GrantStore(dir);
    await store.load();
    await store.add('p1', TEST);
    await store.add(undefined, FETCH);
    const again = new GrantStore(dir);
    await again.load();
    expect(again.rulesFor('p1')).toEqual([TEST]);
    expect(again.rulesFor(undefined)).toEqual([FETCH]);
    expect(again.rulesFor('p2')).toEqual([]);
  });

  it('remembers a rule once; takes one back; forgets a whole project', async () => {
    const store = new GrantStore(await folder());
    await store.load();
    await store.add('p1', TEST);
    await store.add('p1', { ...TEST, args: ['test'] });
    expect(store.rulesFor('p1')).toHaveLength(1);
    await store.add('p1', FETCH);
    await store.revoke('p1', TEST);
    expect(store.rulesFor('p1')).toEqual([FETCH]);
    await store.dropProject('p1');
    expect(store.rulesFor('p1')).toEqual([]);
  });

  it('refuses to remember what could not be remembered', async () => {
    const store = new GrantStore(await folder());
    await store.load();
    await expect(store.add('p1', { tool: 'run_command', program: 'bash' })).rejects.toThrow(/cannot be remembered/);
  });

  it('two rules added at once are both kept', async () => {
    const dir = await folder();
    const store = new GrantStore(dir);
    await store.load();
    await Promise.all([store.add('p1', TEST), store.add('p1', FETCH)]);
    const again = new GrantStore(dir);
    await again.load();
    expect(again.rulesFor('p1')).toHaveLength(2);
  });

  it('a file written by hand is read through the same rule: what could not have been remembered is dropped', async () => {
    const dir = await folder();
    await writeFile(
      join(dir, 'grants.json'),
      JSON.stringify({
        version: 1,
        projects: {
          p1: [TEST, { tool: 'run_command', program: 'pnpm', args: ['test', '&&', 'curl', 'x'] }, { tool: 'run_command', program: 'cmd' }, 'junk'],
        },
      }),
    );
    const store = new GrantStore(dir);
    await store.load();
    expect(store.rulesFor('p1')).toEqual([TEST]);
  });

  it('a missing or unreadable file is an empty store, not a refusal to start', async () => {
    const dir = await folder();
    const store = new GrantStore(dir);
    await store.load();
    expect(store.all()).toEqual([]);
    await writeFile(join(dir, 'grants.json'), '{ not json');
    const broken = new GrantStore(dir);
    await broken.load();
    expect(broken.all()).toEqual([]);
  });
});
