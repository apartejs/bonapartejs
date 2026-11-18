import { describe, expect, it } from 'vitest';
import type { CatalogueEntry } from '../models/catalogue.js';
import { DEFAULT_PREFILL_TOKENS_PER_SECOND } from '../costs/announce.js';
import { modelUpdates, rereadCost } from './check.js';

const entry = (over: Partial<CatalogueEntry> = {}): CatalogueEntry => ({
  id: 'qwen-next',
  family: 'qwen',
  name: 'Qwen Next',
  repo: 'qwen/next-gguf',
  file: 'qwen-next-q4_k_xl.gguf',
  bytes: 21_300_000_000,
  sha256: 'ab'.repeat(32),
  context: 32_768,
  fromGiB: 24,
  ...over,
});

describe('modelUpdates (task 13.1)', () => {
  it('offers an entry when a file it replaces is on the disk and it is not', () => {
    const next = entry({ replaces: ['qwen-next-q4_k_m.gguf'] });
    const found = modelUpdates([next], ['C:\\models\\qwen-next-q4_k_m.gguf'], []);
    expect(found).toEqual([{ entry: next, replaces: 'C:\\models\\qwen-next-q4_k_m.gguf' }]);
  });

  it('offers nothing once the new file is there too', () => {
    const next = entry({ replaces: ['old.gguf'] });
    expect(modelUpdates([next], ['/m/old.gguf', '/m/qwen-next-q4_k_xl.gguf'], [])).toEqual([]);
  });

  it('offers nothing for a file the person never had, nor for an entry that replaces none', () => {
    expect(modelUpdates([entry({ replaces: ['old.gguf'] }), entry({ id: 'plain' })], ['/m/other.gguf'], [])).toEqual([]);
  });

  it('never offers again a version the person kept', () => {
    expect(modelUpdates([entry({ replaces: ['old.gguf'] })], ['/m/old.gguf'], ['qwen-next'])).toEqual([]);
  });

  it('matches the file name whatever its case', () => {
    expect(modelUpdates([entry({ replaces: ['Old.GGUF'] })], ['/m/old.gguf'], [])).toHaveLength(1);
  });
});

describe('rereadCost (task 13.1)', () => {
  it('counts the conversations kept in memory, their tokens and the time to read them again', () => {
    expect(rereadCost([10_000, 20_000, 30_000], 200)).toEqual({ conversations: 3, tokens: 60_000, seconds: 300 });
  });

  it('reads at the default speed until one is measured', () => {
    expect(rereadCost([DEFAULT_PREFILL_TOKENS_PER_SECOND * 7], undefined)).toEqual({
      conversations: 1,
      tokens: DEFAULT_PREFILL_TOKENS_PER_SECOND * 7,
      seconds: 7,
    });
  });

  it('costs nothing when no conversation is kept', () => {
    expect(rereadCost([], 200)).toEqual({ conversations: 0, tokens: 0, seconds: 0 });
  });
});
