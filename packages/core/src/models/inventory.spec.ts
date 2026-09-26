import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
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
  it('finds .gguf files recursively with size, date, and source', async () => {
    const root = await tree({
      'qwen3-8b-q4.gguf': 'x'.repeat(64),
      'sous/dossier/qwen3-1.7b.GGUF': 'y'.repeat(32),
      'notes.txt': 'not a model',
    });
    const models = await scanModels([{ dir: root, source: 'lmstudio' }]);
    expect(models.map((m) => m.name).sort()).toEqual(['qwen3-1.7b', 'qwen3-8b-q4']);
    const big = models.find((m) => m.name === 'qwen3-8b-q4')!;
    expect(big.sizeBytes).toBe(64);
    expect(big.source).toBe('lmstudio');
    expect(Date.parse(big.modifiedAt)).toBeGreaterThan(0);
    expect(big.path).toBe(join(root, 'qwen3-8b-q4.gguf'));
  });

  it('skips multimodal projector files — they are not models on their own', async () => {
    // Paul, 2026-08-28: he picked "mmproj-Qwen3.6-35B-A3B-BF16.gguf" by
    // mistake and the server crashed. An mmproj is the vision projector of a
    // multimodal model, useless to load alone; llama.cpp names it "mmproj-…".
    const root = await tree({
      'Qwen3.6-35B-A3B-Q4_K_M.gguf': 'x'.repeat(64),
      'mmproj-Qwen3.6-35B-A3B-BF16.gguf': 'y'.repeat(16),
      'sub/mmproj-model-f16.GGUF': 'z'.repeat(8),
    });
    const models = await scanModels([{ dir: root, source: 'lmstudio' }]);
    expect(models.map((m) => m.name)).toEqual(['Qwen3.6-35B-A3B-Q4_K_M']);
  });

  it('silently ignores absent roots', async () => {
    const root = await tree({ 'm.gguf': 'x' });
    const models = await scanModels([
      { dir: 'C:\\nexiste\\pas\\du\\tout', source: 'hf-cache' },
      { dir: root, source: 'custom' },
    ]);
    expect(models).toHaveLength(1);
    expect(models[0]!.source).toBe('custom');
  });

  it('respects the maximum depth', async () => {
    const root = await tree({
      'a/b/c/d/e/very-deep.gguf': 'x',
      'close.gguf': 'x',
    });
    const models = await scanModels([{ dir: root, source: 'custom' }], {
      maxDepth: 2,
    });
    expect(models.map((m) => m.name)).toEqual(['close']);
  });

  it('deduplicates the same file seen through two roots', async () => {
    const root = await tree({ 'm.gguf': 'x' });
    const models = await scanModels([
      { dir: root, source: 'lmstudio' },
      { dir: root, source: 'custom' },
    ]);
    expect(models).toHaveLength(1);
  });

  it('sorts by name', async () => {
    const root = await tree({
      'zeta.gguf': 'x',
      'alpha.gguf': 'x',
      'middle.gguf': 'x',
    });
    const models = await scanModels([{ dir: root, source: 'custom' }]);
    expect(models.map((m) => m.name)).toEqual(['alpha', 'middle', 'zeta']);
  });
});

describe('defaultScanRoots', () => {
  it('offers LM Studio and the Hugging Face cache', () => {
    const roots = defaultScanRoots({});
    expect(roots.some((r) => r.source === 'lmstudio')).toBe(true);
    expect(roots.some((r) => r.source === 'hf-cache')).toBe(true);
  });

  it('BONAPARTE_MODEL_DIRS replaces them — folders of your own, and a machine-independent test', () => {
    const roots = defaultScanRoots({ BONAPARTE_MODEL_DIRS: ['/models/a', '/models/b'].join(delimiter) });
    expect(roots).toEqual([
      { dir: '/models/a', source: 'custom' },
      { dir: '/models/b', source: 'custom' },
    ]);
  });
});
