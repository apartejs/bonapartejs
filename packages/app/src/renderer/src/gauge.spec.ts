/**
 * The prefill, read honestly (P2.8): how much of the prompt is done, and —
 * once the speed of THIS prefill is measurable — about how long is left.
 * Before that, no figure: an estimate from nothing is a guess.
 */

import { describe, expect, it } from 'vitest';
import { formatDuration, prefillRemainingMs } from './gauge.js';

describe('prefillRemainingMs', () => {
  it('extrapolates from what this prefill computed so far — cached tokens cost nothing', () => {
    // 1 000 cached, 1 000 computed in 2 s: 500 tokens/s; 3 000 left → 6 s.
    expect(prefillRemainingMs({ total: 5_000, cache: 1_000, processed: 2_000, timeMs: 2_000 })).toBe(6_000);
  });

  it('says nothing before anything was computed, or once all is done', () => {
    expect(prefillRemainingMs({ total: 5_000, cache: 1_000, processed: 1_000, timeMs: 0 })).toBeNull();
    expect(prefillRemainingMs({ total: 5_000, cache: 0, processed: 100, timeMs: 0 })).toBeNull();
    expect(prefillRemainingMs({ total: 5_000, cache: 0, processed: 5_000, timeMs: 9_000 })).toBeNull();
  });
});

describe('formatDuration', () => {
  it('reads at the scale of the wait', () => {
    expect(formatDuration(450)).toBe('450 ms');
    expect(formatDuration(1_234)).toBe('1.2 s');
    expect(formatDuration(42_000)).toBe('42 s');
    expect(formatDuration(95_000)).toBe('1 min 35 s');
    expect(formatDuration(3_600_000)).toBe('60 min');
  });
});
