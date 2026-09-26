/**
 * What this machine measured, per model — how long it took to load, how
 * fast it prefills — kept across launches (P2.8). Without it, every
 * announcement after a restart would read "unknown" until the model had
 * been loaded and used again: the costs the product promises to state
 * would be stated only the second time.
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MeasureStore } from './measures.js';

describe('MeasureStore', () => {
  it('keeps each model’s figures, merged, and finds them again at the next launch', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'bp-measures-')), 'measures.json');
    const first = new MeasureStore(file);
    expect(first.get('a.gguf')).toBeUndefined();

    first.record('a.gguf', { loadSeconds: 12.5 });
    first.record('a.gguf', { prefillTokensPerSecond: 480 });
    first.record('b.gguf', { loadSeconds: 3 });
    await first.flush();

    expect(first.get('a.gguf')).toEqual({ loadSeconds: 12.5, prefillTokensPerSecond: 480 });
    const next = new MeasureStore(file);
    expect(next.get('a.gguf')).toEqual({ loadSeconds: 12.5, prefillTokensPerSecond: 480 });
    expect(next.get('b.gguf')).toEqual({ loadSeconds: 3 });
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 1 });
  });

  it('a missing or unreadable file is an empty memory, never an error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bp-measures-'));
    expect(new MeasureStore(join(dir, 'absent.json')).get('a.gguf')).toBeUndefined();
    const corrupt = join(dir, 'corrupt.json');
    await writeFile(corrupt, '{ not json', 'utf8');
    const store = new MeasureStore(corrupt);
    expect(store.get('a.gguf')).toBeUndefined();
    // And it still records — the next write replaces the garbage.
    store.record('a.gguf', { loadSeconds: 1 });
    await store.flush();
    expect(new MeasureStore(corrupt).get('a.gguf')).toEqual({ loadSeconds: 1 });
  });

  it('ignores figures that are not measurements', () => {
    const store = new MeasureStore();
    store.record('a.gguf', { loadSeconds: Number.NaN, prefillTokensPerSecond: -3 });
    expect(store.get('a.gguf')).toBeUndefined();
    store.record('a.gguf', { loadSeconds: 0 });
    expect(store.get('a.gguf')).toEqual({ loadSeconds: 0 });
  });
});
