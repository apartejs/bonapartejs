/**
 * What a model load costs, said before it is paid: the video memory it will
 * take against the card's, and how long it will take — measured, or
 * estimated and said so. The canvas's figures are examples; these tests pin
 * our formulas. Sizes are binary: 1 GiB = 1024³ bytes.
 */

import { describe, expect, it } from 'vitest';
import type { GgufInfo } from '../models/gguf.js';
import { announceLoad, suggestOffload, type LoadModel } from './announce.js';

const GiB = 1024 ** 3;

/** A model of 21.3 GiB whose KV cache costs 20 480 bytes a token in f16, over 40 blocks. */
const info: GgufInfo = {
  architecture: 'qwen35moe',
  blockCount: 40,
  fullKvLayers: 10,
  swaKvLayers: 0,
  slidingWindow: 0,
  fullKvElementsPerToken: 10_240,
  swaKvElementsPerToken: 0,
  tensorCount: 700,
  family: 'qwen',
};
const model: LoadModel = { info, fileBytes: 21.3 * GiB };
const settings = { nCtx: 32_768, cacheType: 'f16' as const, gpuLayers: 'all' as const };

describe('announceLoad', () => {
  it('asks for the file, the context and a margin: 21.3 + 0.625 + 0.5 = 22.4 GiB', () => {
    const announcement = announceLoad(model, settings, { totalBytes: 24 * GiB });
    expect(announcement.kind).toBe('engine-load');
    // To the byte: the file's size is a whole number of bytes.
    expect(announcement.vramBytes).toBeCloseTo(21.3 * GiB + 0.625 * GiB + 0.5 * GiB, -1);
    expect(announcement.vramBytes / GiB).toBeCloseTo(22.4, 1);
  });

  it('is tight on a 24 GiB card, fits on 32, is too big on 12 — with both figures', () => {
    const on = (gib: number) => announceLoad(model, settings, { totalBytes: gib * GiB });
    expect(on(24)).toMatchObject({ verdict: 'tight', gpuBytes: 24 * GiB });
    expect(on(32)).toMatchObject({ verdict: 'fits', gpuBytes: 32 * GiB });
    expect(on(12)).toMatchObject({ verdict: 'too-big', gpuBytes: 12 * GiB });
    expect(on(12).vramBytes).toBeGreaterThan(on(12).gpuBytes!);
  });

  it('says unknown, never zero, when the card was not measured', () => {
    const announcement = announceLoad(model, settings, { totalBytes: null });
    expect(announcement.verdict).toBe('unknown');
    expect(announcement.gpuBytes).toBeNull();
  });

  it('takes the load time this machine measured', () => {
    const announcement = announceLoad({ ...model, loadSeconds: 41.2 }, settings, { totalBytes: 24 * GiB });
    expect(announcement).toMatchObject({ seconds: 41.2, secondsEstimated: false });
  });

  it('without a measure, estimates it from the size of the file, and says it is an estimate', () => {
    const announcement = announceLoad(model, settings, { totalBytes: 24 * GiB });
    expect(announcement.secondsEstimated).toBe(true);
    expect(announcement.seconds).toBeGreaterThan(0);
    // A bigger file takes longer.
    const bigger = announceLoad({ ...model, fileBytes: 40 * GiB }, settings, { totalBytes: 24 * GiB });
    expect(bigger.seconds).toBeGreaterThan(announcement.seconds);
  });

  it('with part of the model on the processor, counts only what goes on the card', () => {
    const half = announceLoad(model, { ...settings, gpuLayers: 20 }, { totalBytes: 12 * GiB });
    expect(half.vramBytes).toBeCloseTo((21.3 * GiB + 0.625 * GiB) / 2 + 0.5 * GiB, -1);
    expect(half.verdict).toBe('tight');
  });
});

describe('suggestOffload', () => {
  it('when the model is too big, gives the layers that fit, in proportion to its blocks', () => {
    // One layer: (21.3 + 0.625) / 40 GiB; the card holds 11.5 GiB after the margin.
    expect(suggestOffload(model, settings, { totalBytes: 12 * GiB })).toEqual({ gpuLayers: 20 });
  });

  it('suggests nothing when nothing fits, when it fits whole, or when the card is unknown', () => {
    expect(suggestOffload(model, settings, { totalBytes: 0.4 * GiB })).toBeNull();
    expect(suggestOffload(model, settings, { totalBytes: 32 * GiB })).toBeNull();
    expect(suggestOffload(model, settings, { totalBytes: null })).toBeNull();
  });
});
