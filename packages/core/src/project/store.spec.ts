/**
 * The projects: a name, folders (the first one is where a relative path is
 * read from, so their order matters), and the mode a new conversation starts
 * in. A folder on the network is never one.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NetworkPathError } from './paths.js';
import { ProjectStore } from './store.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-projects-'));
  dirs.push(dir);
  return dir;
}

describe('ProjectStore', () => {
  it('creates a project with absolute folders, in order, once each, in Répétition by default', async () => {
    const store = new ProjectStore(await folder());
    const project = await store.create({ name: 'spanwise', roots: ['C:/code/spanwise', 'C:/code/lib', 'C:/code/spanwise'] });
    expect(project.roots).toEqual([resolve('C:/code/spanwise'), resolve('C:/code/lib')]);
    expect(project.defaultMode).toBe('repetition');
    expect(project.id).toMatch(/\w/);
  });

  it('lists, reads, changes and removes; the changes survive a restart', async () => {
    const dir = await folder();
    const store = new ProjectStore(dir);
    const a = await store.create({ name: 'a', roots: [] });
    const b = await store.create({ name: 'b', roots: [], defaultMode: 'plume' });
    await store.update(a.id, { name: 'alpha', defaultMode: 'lecture' });
    await store.remove(b.id);
    const again = new ProjectStore(dir);
    expect((await again.list()).map((project) => [project.name, project.defaultMode])).toEqual([['alpha', 'lecture']]);
    expect(await again.get(b.id)).toBeUndefined();
  });

  it('changing an unknown project says so', async () => {
    const store = new ProjectStore(await folder());
    await expect(store.update('nope', { name: 'x' })).rejects.toThrow(/Unknown project: nope/);
  });

  it('never takes a folder on the network', async () => {
    const store = new ProjectStore(await folder());
    await expect(store.create({ name: 'share', roots: ['\\\\server\\share\\code'] })).rejects.toThrow(NetworkPathError);
    const project = await store.create({ name: 'local', roots: [] });
    await expect(store.update(project.id, { roots: ['//server/share'] })).rejects.toThrow(NetworkPathError);
  });

  it('two projects created at once are both kept', async () => {
    const dir = await folder();
    const store = new ProjectStore(dir);
    await Promise.all([store.create({ name: 'one', roots: [] }), store.create({ name: 'two', roots: [] })]);
    expect((await new ProjectStore(dir).list()).map((project) => project.name).sort()).toEqual(['one', 'two']);
  });

  it('a missing or unreadable file is no project, not a refusal to start', async () => {
    const dir = await folder();
    expect(await new ProjectStore(dir).list()).toEqual([]);
    await writeFile(join(dir, 'projects.json'), '{ broken');
    expect(await new ProjectStore(dir).list()).toEqual([]);
  });
});
