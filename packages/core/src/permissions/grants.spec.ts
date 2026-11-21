/**
 * The rules « always allow » remembered (audit 2026-11-21, D3): the app's,
 * each project's and each conversation's own, kept on disk; a conversation's
 * go with it. What is written by hand — or by anything but the app — is read
 * again through the same rule: a rule that could not have been remembered is
 * dropped.
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
const SITE: AllowRule = { tool: 'browser_act', origin: 'http://localhost:5173' };
const SRC: AllowRule = { tool: 'edit_file', path: 'src/**' };
const p1 = { kind: 'project', projectId: 'p1' } as const;
const c1 = { kind: 'conversation', conversationId: 'c1' } as const;
const app = { kind: 'app' } as const;

describe('GrantStore', () => {
  it('keeps the app’s rules, each project’s and each conversation’s, across a restart', async () => {
    const dir = await folder();
    const store = new GrantStore(dir);
    await store.load();
    await store.add(p1, TEST);
    await store.add(app, SITE);
    await store.add(c1, SRC);
    const again = new GrantStore(dir);
    await again.load();
    expect(again.rulesFor('p1')).toEqual([SITE, TEST]);
    expect(again.rulesFor('p1', 'c1')).toEqual([SITE, TEST, SRC]);
    // A conversation's own rule answers for it alone; a project's for its conversations alone.
    expect(again.rulesFor('p1', 'c2')).toEqual([SITE, TEST]);
    expect(again.rulesFor('p2', 'c2')).toEqual([SITE]);
    expect(again.rulesFor(undefined)).toEqual([SITE]);
  });

  it('remembers a rule once; takes one back; forgets a whole project, a whole conversation', async () => {
    const store = new GrantStore(await folder());
    await store.load();
    await store.add(p1, TEST);
    await store.add(p1, { ...TEST, args: ['test'] });
    expect(store.list(p1)).toHaveLength(1);
    await store.add(p1, SRC);
    await store.revoke(p1, TEST);
    expect(store.list(p1)).toEqual([SRC]);
    await store.dropProject('p1');
    expect(store.list(p1)).toEqual([]);
    await store.add(c1, TEST);
    await store.dropConversation('c1');
    expect(store.rulesFor('p1', 'c1')).toEqual([]);
  });

  it('refuses to remember what could not be remembered: a shell, a program without its exact arguments', async () => {
    const store = new GrantStore(await folder());
    await store.load();
    await expect(store.add(p1, { tool: 'run_command', program: 'bash', args: ['-c', 'ls'] })).rejects.toThrow(/cannot be remembered/);
    await expect(store.add(p1, { tool: 'run_command', program: 'git' })).rejects.toThrow(/cannot be remembered/);
  });

  it('two rules added at once are both kept', async () => {
    const dir = await folder();
    const store = new GrantStore(dir);
    await store.load();
    await Promise.all([store.add(p1, TEST), store.add(p1, SRC)]);
    const again = new GrantStore(dir);
    await again.load();
    expect(again.list(p1)).toHaveLength(2);
  });

  it('a file written by hand is read through the same rule: what could not have been remembered is dropped', async () => {
    const dir = await folder();
    await writeFile(
      join(dir, 'grants.json'),
      JSON.stringify({
        version: 2,
        app: [SITE, { tool: 'browser_act', origin: 'https://example.com/path' }],
        projects: {
          p1: [TEST, { tool: 'run_command', program: 'pnpm', args: ['test', '&&', 'curl', 'x'] }, { tool: 'run_command', program: 'cmd', args: [] }, { tool: 'run_command', program: 'git' }, { tool: 'edit_file', path: '../x' }, 'junk'],
        },
        conversations: { c1: [SRC] },
      }),
    );
    const store = new GrantStore(dir);
    await store.load();
    expect(store.list(app)).toEqual([SITE]);
    expect(store.list(p1)).toEqual([TEST]);
    expect(store.list(c1)).toEqual([SRC]);
  });

  it('the first version’s rules are read: the bucket of no project is the app’s, a program alone is dropped', async () => {
    const dir = await folder();
    await writeFile(
      join(dir, 'grants.json'),
      JSON.stringify({ version: 1, projects: { p1: [TEST, { tool: 'run_command', program: 'pnpm' }], '': [{ tool: 'web_search' }] } }),
    );
    const store = new GrantStore(dir);
    await store.load();
    expect(store.list(p1)).toEqual([TEST]);
    expect(store.list(app)).toEqual([{ tool: 'web_search' }]);
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
