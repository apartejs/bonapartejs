import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectStore } from './store.js';

let dirs: string[] = [];

async function store(): Promise<ProjectStore> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-projects-'));
  dirs.push(dir);
  return new ProjectStore(dir);
}

afterEach(async () => {
  await Promise.all(
    dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)),
  );
  dirs = [];
});

describe('ProjectStore', () => {
  it('starts from an empty list with no file', async () => {
    expect(await (await store()).list()).toEqual([]);
  });

  it('creates a project with its roots, making them absolute', async () => {
    const s = await store();
    const p = await s.create({ name: 'bonaparte', roots: ['./un', './deux'] });

    expect(p.name).toBe('bonaparte');
    expect(p.roots).toEqual([resolve('./un'), resolve('./deux')]);
    expect(p.id).toBeTruthy();
    expect(await s.list()).toHaveLength(1);
  });

  it('accepts a project with NO root — it’s a legitimate group', async () => {
    const s = await store();
    const p = await s.create({ name: 'idées' });
    expect(p.roots).toEqual([]);
  });

  it('renames without touching the roots', async () => {
    const s = await store();
    const p = await s.create({ name: 'before', roots: ['./a'] });
    const after = await s.rename(p.id, 'after');

    expect(after.name).toBe('after');
    expect(after.roots).toEqual(p.roots);
  });

  it('replaces the roots, and the ORDER is kept as-is', async () => {
    // The order is semantic: the first root is the default for relative
    // paths. Reordering must therefore be a faithful operation.
    const s = await store();
    const p = await s.create({ name: 'p', roots: ['./a', './b'] });
    const after = await s.setRoots(p.id, ['./b', './a']);

    expect(after.roots).toEqual([resolve('./b'), resolve('./a')]);
  });

  it('deduplicates repeated roots', async () => {
    const s = await store();
    const p = await s.create({ name: 'p', roots: ['./a', './a', './b'] });
    expect(p.roots).toEqual([resolve('./a'), resolve('./b')]);
  });

  it('removes a project', async () => {
    const s = await store();
    const p = await s.create({ name: 'p' });
    await s.remove(p.id);

    expect(await s.list()).toEqual([]);
    expect(await s.get(p.id)).toBeUndefined();
  });

  it('returns undefined for an unknown project, without throwing', async () => {
    expect(await (await store()).get('fantome')).toBeUndefined();
  });

  it('throws on a modification of an unknown project', async () => {
    await expect((await store()).rename('fantome', 'x')).rejects.toThrow(/fantome/);
  });

  it('persists across two instances', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bp-projects-'));
    dirs.push(dir);

    const created = await new ProjectStore(dir).create({ name: 'p', roots: ['./a'] });
    const relu = await new ProjectStore(dir).get(created.id);

    expect(relu?.name).toBe('p');
    expect(relu?.roots).toEqual([resolve('./a')]);
  });

  it('survives a corrupted file rather than losing everything', async () => {
    // An unreadable JSON must not prevent the app from starting: we start
    // over from an empty list, which is fixable, instead of throwing on load.
    const dir = await mkdtemp(join(tmpdir(), 'bp-projects-'));
    dirs.push(dir);
    await writeFile(join(dir, 'projects.json'), '{ not json', 'utf8');

    expect(await new ProjectStore(dir).list()).toEqual([]);
  });

  it('writes a file that is re-readable and versioned', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bp-projects-'));
    dirs.push(dir);
    await new ProjectStore(dir).create({ name: 'p' });

    const raw = JSON.parse(await readFile(join(dir, 'projects.json'), 'utf8')) as {
      version: number;
      projects: unknown[];
    };
    expect(raw.version).toBe(1);
    expect(raw.projects).toHaveLength(1);
  });
});
