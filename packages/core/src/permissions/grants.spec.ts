/**
 * What "always allow" grants is remembered PER PROJECT, on disk, and can be
 * taken back (P1.8, D-29). A grant given in one project never answers for
 * another; a restart does not forget it; the hub lists and revokes it.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PermissionEngine } from './engine.js';
import { GrantStore } from './grants.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

async function store(): Promise<{ grants: GrantStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-grants-'));
  dirs.push(dir);
  return { grants: new GrantStore(dir), dir };
}

describe('GrantStore — grants per project, on disk', () => {
  it('a grant is kept for its project only, and survives a new store on the same folder', async () => {
    const { grants, dir } = await store();
    await grants.load();
    await grants.add('proj-a', { tool: 'run_shell', commandPrefix: 'pnpm' });

    expect(grants.rulesFor('proj-a')).toEqual([{ tool: 'run_shell', commandPrefix: 'pnpm' }]);
    expect(grants.rulesFor('proj-b')).toEqual([]);
    expect(grants.rulesFor(undefined)).toEqual([]);

    const reloaded = new GrantStore(dir);
    await reloaded.load();
    expect(reloaded.rulesFor('proj-a')).toEqual([{ tool: 'run_shell', commandPrefix: 'pnpm' }]);
  });

  it('a conversation without a project has its own bucket', async () => {
    const { grants } = await store();
    await grants.load();
    await grants.add(undefined, { tool: 'edit_file' });
    expect(grants.rulesFor(undefined)).toEqual([{ tool: 'edit_file' }]);
    expect(grants.rulesFor('proj-a')).toEqual([]);
  });

  it('adding the same grant twice keeps one', async () => {
    const { grants } = await store();
    await grants.load();
    await grants.add('p', { tool: 'run_shell', exactCommand: 'pnpm test' });
    await grants.add('p', { tool: 'run_shell', exactCommand: 'pnpm test' });
    expect(grants.rulesFor('p')).toHaveLength(1);
  });

  it('revoke takes one grant back; dropProject takes them all', async () => {
    const { grants } = await store();
    await grants.load();
    await grants.add('p', { tool: 'run_shell', commandPrefix: 'git' });
    await grants.add('p', { tool: 'edit_file' });

    await grants.revoke('p', { tool: 'run_shell', commandPrefix: 'git' });
    expect(grants.rulesFor('p')).toEqual([{ tool: 'edit_file' }]);

    await grants.dropProject('p');
    expect(grants.rulesFor('p')).toEqual([]);
  });

  it('all() lists every grant with its project, for the hub', async () => {
    const { grants } = await store();
    await grants.load();
    await grants.add('p', { tool: 'edit_file' });
    await grants.add(undefined, { tool: 'run_shell', exactCommand: 'ls' });
    expect(grants.all()).toEqual([
      { projectId: 'p', rule: { tool: 'edit_file' } },
      { projectId: undefined, rule: { tool: 'run_shell', exactCommand: 'ls' } },
    ]);
  });

  it('a missing or corrupted file is an empty store, not a crash — and it is rewritten cleanly', async () => {
    const { grants, dir } = await store();
    await writeFile(join(dir, 'grants.json'), '{ not json', 'utf8');
    await grants.load();
    expect(grants.all()).toEqual([]);
    await grants.add('p', { tool: 'edit_file' });
    expect(JSON.parse(await readFile(join(dir, 'grants.json'), 'utf8'))).toMatchObject({ version: 1 });
  });

  it('a malformed rule on disk is dropped, not trusted', async () => {
    const { grants, dir } = await store();
    await writeFile(
      join(dir, 'grants.json'),
      JSON.stringify({ version: 1, projects: { p: [{ tool: 'edit_file' }, { nope: true }, { tool: 3 }] } }),
      'utf8',
    );
    await grants.load();
    expect(grants.rulesFor('p')).toEqual([{ tool: 'edit_file' }]);
  });
});

describe('PermissionEngine — rules read live from a provider', () => {
  it('evaluates against whatever the provider returns now', () => {
    let rules = [{ tool: 'write_file' }];
    const perm = new PermissionEngine('repetition', () => rules);
    expect(perm.evaluate({ tool: 'write_file', effect: 'write' })).toBe('allow');
    rules = [];
    expect(perm.evaluate({ tool: 'write_file', effect: 'write' })).toBe('ask');
  });
});
