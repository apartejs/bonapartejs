/**
 * What a model load costs, said before it is paid: the video memory it will
 * take against the card's, and how long it will take — measured, or
 * estimated and said so. The canvas's figures are examples; these tests pin
 * our formulas. Sizes are binary: 1 GiB = 1024³ bytes.
 */

import { describe, expect, it } from 'vitest';
import type { GgufInfo } from '../models/gguf.js';
import { announceContext, announceLoad, announceOpen, suggestOffload, type LoadModel } from './announce.js';

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

describe('announceOpen', () => {
  const MiB = 1024 ** 2;
  const saved = { promptTokenCount: 31_240, slotFileBytes: 31_240 * 20_480, savedAt: '2026-11-14T13:40:00.000Z' };

  it('a state that can be restored: its time, the re-read it spares, its size on disk and its date', () => {
    const announcement = announceOpen({
      resident: false,
      promptTokens: 31_240,
      saved,
      refusal: null,
      measures: { prefillTokensPerSecond: 130, restoreBytesPerSecond: 2 * 1024 * MiB },
    });
    expect(announcement).toEqual({
      kind: 'restore',
      tokens: 31_240,
      seconds: (31_240 * 20_480) / (2 * 1024 * MiB),
      insteadOfSeconds: 31_240 / 130,
      bytes: 31_240 * 20_480,
      savedAt: '2026-11-14T13:40:00.000Z',
      estimated: false,
    });
    // 610 MiB on disk.
    expect(Math.round(announcement?.kind === 'restore' ? announcement.bytes / MiB : 0)).toBe(610);
  });

  const letGo = { at: '2026-11-11T09:00:00.000Z', budgetBytes: 20 * 1024 ** 3 };

  it('a memory let go is a re-read, with its time: 22 100 tokens at 130 a second, 170 s — and when, under which budget', () => {
    expect(
      announceOpen({
        resident: false,
        promptTokens: 22_100,
        saved: null,
        refusal: 'missing',
        evicted: letGo,
        measures: { prefillTokensPerSecond: 130 },
      }),
    ).toEqual({ kind: 'reread', tokens: 22_100, seconds: 170, reason: 'evicted', evicted: letGo, estimated: false });
  });

  it('a memory never saved — the app closed first, or the save failed — says so, not that it was let go', () => {
    expect(announceOpen({ resident: false, promptTokens: 1000, saved: null, refusal: 'missing', measures: {} })).toMatchObject({
      kind: 'reread',
      reason: 'not-saved',
    });
  });

  it('a memory older than the conversation: its state is restored, and what came after is read — that, and only that, is announced', () => {
    expect(
      announceOpen({
        resident: false,
        promptTokens: 25_000,
        saved: { ...saved, promptTokenCount: 2_000 },
        refusal: null,
        behind: true,
        measures: { prefillTokensPerSecond: 200 },
      }),
    ).toEqual({ kind: 'reread', tokens: 23_000, seconds: 115, reason: 'behind', estimated: false });
  });

  it('what remains to read is counted on what came after the state, in one unit — not a measure taken from an estimate', () => {
    expect(
      announceOpen({
        resident: false,
        promptTokens: 25_000,
        saved: { ...saved, promptTokenCount: 2_000 },
        refusal: null,
        behind: true,
        behindTokens: 1_500,
        measures: { prefillTokensPerSecond: 150 },
      }),
    ).toMatchObject({ kind: 'reread', tokens: 1_500, seconds: 10, reason: 'behind' });
  });

  it('the engine died in the middle of the last answer: said so, with what remains to read', () => {
    expect(
      announceOpen({
        resident: false,
        promptTokens: 25_000,
        saved: { ...saved, promptTokenCount: 2_000 },
        refusal: null,
        behind: true,
        diedMidAnswer: true,
        measures: {},
      }),
    ).toMatchObject({ kind: 'reread', tokens: 23_000, reason: 'engine-died' });
    expect(announceOpen({ resident: false, promptTokens: 100, saved: null, refusal: 'missing', diedMidAnswer: true, measures: {} })).toMatchObject({
      tokens: 100,
      reason: 'engine-died',
    });
  });

  it('says why a state cannot serve, in the words of the manifest', () => {
    for (const refusal of ['other-model', 'cache-types', 'context-too-small'] as const) {
      expect(announceOpen({ resident: false, promptTokens: 100, saved: null, refusal, measures: {} })).toMatchObject({
        kind: 'reread',
        reason: refusal,
      });
    }
  });

  it('before anything was measured, takes default speeds, and says the figures are estimates', () => {
    expect(announceOpen({ resident: false, promptTokens: 1000, saved, refusal: null, measures: {} })).toMatchObject({
      kind: 'restore',
      estimated: true,
    });
    expect(announceOpen({ resident: false, promptTokens: 1000, saved: null, refusal: 'missing', measures: {} })).toMatchObject({
      kind: 'reread',
      estimated: true,
    });
  });

  it('announces nothing for a conversation already in the slot, or one with nothing to read', () => {
    expect(announceOpen({ resident: true, promptTokens: 22_100, saved: null, refusal: 'missing', measures: {} })).toBeNull();
    expect(announceOpen({ resident: false, promptTokens: 0, saved: null, refusal: 'missing', measures: {} })).toBeNull();
  });
});

describe('announceContext', () => {
  it('speaks from 90 % of the window, with the time a compaction would take', () => {
    expect(announceContext(7_000, 8_192, 12)).toBeNull();
    expect(announceContext(7_400, 8_192, 12)).toEqual({ kind: 'context-full', used: 7_400, window: 8_192, compactSeconds: 12 });
  });
});
