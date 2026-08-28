import type { ModelInfoDto } from '@aparte/bonaparte-shared';
import { describe, expect, it } from 'vitest';
import { filterModels } from './filter.js';

const model = (name: string, path: string): ModelInfoDto => ({
  name,
  path,
  sizeBytes: 1,
  modifiedAt: '2026-08-28T00:00:00.000Z',
  source: 'lmstudio',
});

const models = [
  model('Qwen3-1.7B-Q4_K_M', 'C:/models/unsloth/Qwen3-1.7B-GGUF/Qwen3-1.7B-Q4_K_M.gguf'),
  model('gemma-4-E4B-it-Q4_K_M', 'C:/models/lmstudio-community/gemma-4-E4B-it-GGUF/x.gguf'),
  model('aimi-v3.5-iter2-q4', 'C:/models/aimi/lfm2.5-1.2b-aimi-v3.5-iter2/aimi-v3.5-iter2-q4.gguf'),
];

describe('filterModels', () => {
  it('returns everything for an empty query', () => {
    expect(filterModels(models, '')).toEqual(models);
    expect(filterModels(models, '   ')).toEqual(models);
  });

  it('matches every term, in any order, against the name and the path', () => {
    // "qwen 1.7" and "1.7 qwen" mean the same thing; a term may live in the
    // folder name only (the publisher), which the name does not repeat.
    expect(filterModels(models, 'q4 qwen').map((m) => m.name)).toEqual(['Qwen3-1.7B-Q4_K_M']);
    expect(filterModels(models, 'unsloth').map((m) => m.name)).toEqual(['Qwen3-1.7B-Q4_K_M']);
  });

  it('is case-insensitive', () => {
    expect(filterModels(models, 'GEMMA').map((m) => m.name)).toEqual(['gemma-4-E4B-it-Q4_K_M']);
  });

  it('returns nothing when a term matches no model', () => {
    expect(filterModels(models, 'qwen mistral')).toEqual([]);
  });
});
