import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultScanRoots, scanModels } from './inventory.js';

let dirs: string[] = [];

async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bp-models-'));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

describe('scanModels', () => {
  it('trouve les .gguf récursivement avec taille, date et source', async () => {
    const root = await tree({
      'qwen3-8b-q4.gguf': 'x'.repeat(64),
      'sous/dossier/qwen3-1.7b.GGUF': 'y'.repeat(32),
      'notes.txt': 'pas un modèle',
    });
    const models = await scanModels([{ dir: root, source: 'lmstudio' }]);
    expect(models.map((m) => m.name).sort()).toEqual(['qwen3-1.7b', 'qwen3-8b-q4']);
    const big = models.find((m) => m.name === 'qwen3-8b-q4')!;
    expect(big.sizeBytes).toBe(64);
    expect(big.source).toBe('lmstudio');
    expect(Date.parse(big.modifiedAt)).toBeGreaterThan(0);
    expect(big.path).toBe(join(root, 'qwen3-8b-q4.gguf'));
  });

  it('ignore silencieusement les racines absentes', async () => {
    const root = await tree({ 'm.gguf': 'x' });
    const models = await scanModels([
      { dir: 'C:\\nexiste\\pas\\du\\tout', source: 'hf-cache' },
      { dir: root, source: 'custom' },
    ]);
    expect(models).toHaveLength(1);
    expect(models[0]!.source).toBe('custom');
  });

  it('respecte la profondeur maximale', async () => {
    const root = await tree({
      'a/b/c/d/e/tres-profond.gguf': 'x',
      'proche.gguf': 'x',
    });
    const models = await scanModels([{ dir: root, source: 'custom' }], {
      maxDepth: 2,
    });
    expect(models.map((m) => m.name)).toEqual(['proche']);
  });

  it('déduplique un même fichier vu par deux racines', async () => {
    const root = await tree({ 'm.gguf': 'x' });
    const models = await scanModels([
      { dir: root, source: 'lmstudio' },
      { dir: root, source: 'custom' },
    ]);
    expect(models).toHaveLength(1);
  });

  it('trie par nom', async () => {
    const root = await tree({
      'zeta.gguf': 'x',
      'alpha.gguf': 'x',
      'milieu.gguf': 'x',
    });
    const models = await scanModels([{ dir: root, source: 'custom' }]);
    expect(models.map((m) => m.name)).toEqual(['alpha', 'milieu', 'zeta']);
  });
});

describe('defaultScanRoots', () => {
  it('propose LM Studio et le cache Hugging Face', () => {
    const roots = defaultScanRoots();
    expect(roots.some((r) => r.source === 'lmstudio')).toBe(true);
    expect(roots.some((r) => r.source === 'hf-cache')).toBe(true);
  });
});
