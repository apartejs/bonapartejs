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
  it('part d’une liste vide sans fichier', async () => {
    expect(await (await store()).list()).toEqual([]);
  });

  it('crée un projet avec ses racines, en les rendant absolues', async () => {
    const s = await store();
    const p = await s.create({ name: 'bonaparte', roots: ['./un', './deux'] });

    expect(p.name).toBe('bonaparte');
    expect(p.roots).toEqual([resolve('./un'), resolve('./deux')]);
    expect(p.id).toBeTruthy();
    expect(await s.list()).toHaveLength(1);
  });

  it('accepte un projet SANS racine — c’est un groupe légitime', async () => {
    const s = await store();
    const p = await s.create({ name: 'idées' });
    expect(p.roots).toEqual([]);
  });

  it('renomme sans toucher aux racines', async () => {
    const s = await store();
    const p = await s.create({ name: 'avant', roots: ['./a'] });
    const after = await s.rename(p.id, 'après');

    expect(after.name).toBe('après');
    expect(after.roots).toEqual(p.roots);
  });

  it('remplace les racines, et l’ORDRE est conservé tel quel', async () => {
    // L'ordre est sémantique : la première racine est le défaut des chemins
    // relatifs. Le réordonnancement doit donc être une opération fidèle.
    const s = await store();
    const p = await s.create({ name: 'p', roots: ['./a', './b'] });
    const after = await s.setRoots(p.id, ['./b', './a']);

    expect(after.roots).toEqual([resolve('./b'), resolve('./a')]);
  });

  it('déduplique les racines répétées', async () => {
    const s = await store();
    const p = await s.create({ name: 'p', roots: ['./a', './a', './b'] });
    expect(p.roots).toEqual([resolve('./a'), resolve('./b')]);
  });

  it('supprime un projet', async () => {
    const s = await store();
    const p = await s.create({ name: 'p' });
    await s.remove(p.id);

    expect(await s.list()).toEqual([]);
    expect(await s.get(p.id)).toBeUndefined();
  });

  it('rend undefined pour un projet inconnu, sans lever', async () => {
    expect(await (await store()).get('fantome')).toBeUndefined();
  });

  it('lève sur une modification d’un projet inconnu', async () => {
    await expect((await store()).rename('fantome', 'x')).rejects.toThrow(/fantome/);
  });

  it('persiste entre deux instances', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bp-projects-'));
    dirs.push(dir);

    const created = await new ProjectStore(dir).create({ name: 'p', roots: ['./a'] });
    const relu = await new ProjectStore(dir).get(created.id);

    expect(relu?.name).toBe('p');
    expect(relu?.roots).toEqual([resolve('./a')]);
  });

  it('survit à un fichier corrompu plutôt que de tout perdre', async () => {
    // Un JSON illisible ne doit pas empêcher l'app de démarrer : on repart
    // d'une liste vide, ce qui est réparable, au lieu de lever au chargement.
    const dir = await mkdtemp(join(tmpdir(), 'bp-projects-'));
    dirs.push(dir);
    await writeFile(join(dir, 'projects.json'), '{ pas du json', 'utf8');

    expect(await new ProjectStore(dir).list()).toEqual([]);
  });

  it('écrit un fichier relisible et versionné', async () => {
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
