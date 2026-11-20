/**
 * The cost of a model, said before it is paid (D-03, P1.7): what loading
 * it takes in memory, and what switching a conversation to it costs — the
 * reload, and the context computed again.
 */

import { describe, expect, it } from 'vitest';
import { autoContext, estimateLoad, estimateSwitch, memoryVerdict } from './cost.js';
import type { GgufInfo } from './gguf.js';

const qwen17: GgufInfo = {
  architecture: 'qwen3',
  blockCount: 28,
  fullKvLayers: 28,
  swaKvLayers: 0,
  slidingWindow: 0,
  fullKvElementsPerToken: 28 * 8 * 256,
  swaKvElementsPerToken: 0,
  trainContext: 40960,
  tensorCount: 310,
  family: 'qwen',
};

const GB = 1024 ** 3;

describe('estimateLoad — weights + context + compute buffers', () => {
  it('adds the file, the KV cache at this context and cache type, and a compute margin', () => {
    const estimate = estimateLoad(qwen17, 1.2 * GB, 8192, 'f16');
    expect(estimate.weightsBytes).toBe(Math.round(1.2 * GB));
    expect(estimate.kvBytes).toBe(28 * 8 * 256 * 2 * 8192);
    expect(estimate.overheadBytes).toBeGreaterThan(0);
    expect(estimate.totalBytes).toBe(estimate.weightsBytes + estimate.kvBytes + estimate.overheadBytes);
    expect(estimate.kvBytesPerToken).toBe(28 * 8 * 256 * 2);
  });

  it('a quantized cache takes less', () => {
    expect(estimateLoad(qwen17, GB, 32768, 'q8_0').kvBytes).toBeLessThan(estimateLoad(qwen17, GB, 32768, 'f16').kvBytes);
  });

  it('flags a context larger than the one the model was trained for', () => {
    expect(estimateLoad(qwen17, GB, 65536, 'f16').beyondTraining).toBe(true);
    expect(estimateLoad(qwen17, GB, 8192, 'f16').beyondTraining).toBe(false);
  });
});

describe('memoryVerdict — against the machine, honestly', () => {
  it('fits, tight, too big — or unknown when the machine does not say', () => {
    expect(memoryVerdict(8 * GB, 32 * GB)).toBe('fits');
    expect(memoryVerdict(27 * GB, 32 * GB)).toBe('tight');
    expect(memoryVerdict(40 * GB, 32 * GB)).toBe('too-big');
    expect(memoryVerdict(8 * GB, 0)).toBe('unknown');
  });
});

describe('estimateSwitch — what switching a conversation to another model costs', () => {
  it('names the reload and the tokens computed again, with durations when measured', () => {
    const cost = estimateSwitch({
      load: estimateLoad(qwen17, 20 * GB, 8192, 'f16'),
      contextTokens: 12_000,
      prefillTokensPerSecond: 400,
      loadSeconds: 25,
    });
    expect(cost).toMatchObject({ reprefillTokens: 12_000, reprefillSeconds: 30, loadSeconds: 25 });
    expect(cost.readBytes).toBe(Math.round(20 * GB));
  });

  it('says nothing it has not measured: no speed, no seconds', () => {
    const cost = estimateSwitch({ load: estimateLoad(qwen17, GB, 8192, 'f16'), contextTokens: 500 });
    expect(cost.reprefillSeconds).toBeUndefined();
    expect(cost.loadSeconds).toBeUndefined();
    expect(cost.reprefillTokens).toBe(500);
  });

  it('an empty conversation has nothing to compute again', () => {
    expect(estimateSwitch({ load: estimateLoad(qwen17, GB, 8192, 'f16'), contextTokens: 0 }).reprefillTokens).toBe(0);
  });
});

describe('autoContext — the context a load takes when the person chose none (audit 2026-11-21, D2)', () => {
  it('the largest step that fits the card with room to spare, never past what the model was trained for', () => {
    // Qwen3 1.7B, f16: 112 KiB a token — 3.5 GiB at 32 k.
    expect(autoContext(qwen17, 1.1 * GB, 'f16', 24 * GB)).toBe(32_768);
    expect(autoContext(qwen17, 1.1 * GB, 'f16', 4 * GB)).toBe(8_192);
    expect(autoContext(qwen17, 1.1 * GB, 'f16', 6 * GB)).toBe(16_384);
    expect(autoContext({ ...qwen17, trainContext: 16_384 }, 1.1 * GB, 'f16', 24 * GB)).toBe(16_384);
    // Two slots hold two caches.
    expect(autoContext(qwen17, 1.1 * GB, 'f16', 6 * GB, 2)).toBe(8_192);
  });

  it('8 k when the card is not known, or nothing fits', () => {
    expect(autoContext(qwen17, 1.1 * GB, 'f16', null)).toBe(8_192);
    expect(autoContext(qwen17, 30 * GB, 'f16', 24 * GB)).toBe(8_192);
  });
});
