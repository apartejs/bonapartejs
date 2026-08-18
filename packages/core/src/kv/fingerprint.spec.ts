import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fingerprintModelFile } from './fingerprint.js';

let dirs: string[] = [];

async function tmpModel(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-fp-'));
  dirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

describe('fingerprintModelFile', () => {
  it('est stable pour un fichier inchangé', async () => {
    const path = await tmpModel('qwen.gguf', 'contenu');
    expect(await fingerprintModelFile(path)).toBe(await fingerprintModelFile(path));
  });

  it('change quand le fichier est remplacé (taille ou mtime différents)', async () => {
    const path = await tmpModel('qwen.gguf', 'contenu');
    const before = await fingerprintModelFile(path);
    await writeFile(path, 'contenu totalement différent');
    await utimes(path, new Date(), new Date(Date.now() + 5000));
    expect(await fingerprintModelFile(path)).not.toBe(before);
  });

  it('diffère entre deux chemins distincts au contenu identique', async () => {
    const a = await tmpModel('a.gguf', 'même contenu');
    const b = await tmpModel('b.gguf', 'même contenu');
    expect(await fingerprintModelFile(a)).not.toBe(await fingerprintModelFile(b));
  });

  it('rejette avec une erreur claire si le fichier est absent', async () => {
    await expect(
      fingerprintModelFile('C:\\nexiste\\pas.gguf'),
    ).rejects.toThrow(/pas\.gguf/);
  });
});
