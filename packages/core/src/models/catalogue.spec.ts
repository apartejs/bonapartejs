import { describe, expect, it } from 'vitest';
import { familyLayer } from '../families/index.js';
import { CATALOGUE, modelUrl, recommendedModels } from './catalogue.js';

const GiB = 1024 ** 3;

describe('the recommended models (task 9.5)', () => {
  it('a 24 GiB card gets Gemma 4 26B-A4B first, then Qwen 3 30B-A3B', () => {
    expect(recommendedModels(24 * GiB).map((entry) => entry.id)).toEqual(['gemma-4-26b-a4b', 'qwen3-30b-a3b']);
  });

  it('each tier gets the largest model of each family that fits it', () => {
    expect(recommendedModels(8 * GiB).map((entry) => entry.id)).toEqual(['gemma-4-e4b', 'qwen3-4b']);
    expect(recommendedModels(12 * GiB).map((entry) => entry.id)).toEqual(['gemma-4-12b', 'qwen3-8b']);
    expect(recommendedModels(16 * GiB).map((entry) => entry.id)).toEqual(['gemma-4-12b', 'qwen3-14b']);
    expect(recommendedModels(80 * GiB).map((entry) => entry.id)).toEqual(['gemma-4-31b', 'qwen3-30b-a3b']);
  });

  it('a small card, or one whose memory is not known, gets the smallest models', () => {
    expect(recommendedModels(6 * GiB).map((entry) => entry.id)).toEqual(['gemma-4-e2b', 'qwen3-4b']);
    expect(recommendedModels(null).map((entry) => entry.id)).toEqual(['gemma-4-e2b', 'qwen3-4b']);
  });

  it('every entry is a supported family, a model file (never a vision projector) and its SHA-256', () => {
    for (const entry of CATALOGUE) {
      expect(() => familyLayer(entry.family)).not.toThrow();
      expect(entry.file).toMatch(/\.gguf$/);
      expect(entry.file).not.toMatch(/mmproj/i);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.bytes).toBeGreaterThan(GiB);
      // The file leaves room for the context and the margin in its tier.
      if (entry.fromGiB > 0) expect(entry.bytes).toBeLessThan(entry.fromGiB * GiB * 0.75);
    }
    expect(new Set(CATALOGUE.map((entry) => entry.id)).size).toBe(CATALOGUE.length);
  });

  it('a model is downloaded from its repository on the hub, by its file', () => {
    const entry = CATALOGUE.find((one) => one.id === 'qwen3-8b')!;
    expect(modelUrl(entry, 'https://huggingface.co')).toBe(
      'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf',
    );
  });
});
