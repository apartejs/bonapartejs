/**
 * What breaks, said before anything is paid (task 12.3, board « Quand quelque chose casse »): a model too big for
 * the card is not loaded until the person chooses — part of it on the processor, or another model.
 */

import { describe, expect, it } from 'vitest';
import { decideLoad, ModelTooBigError, planDiskRoom } from './failures.js';

const GIB = 1024 ** 3;

describe('a load decided before anything is launched', () => {
  it('goes when the model fits, or when the card is not known', () => {
    expect(decideLoad({ verdict: 'fits', vramBytes: 10 * GIB, gpuBytes: 24 * GIB, gpuLayers: 'all', suggestion: null, offload: false })).toEqual({ go: true });
    expect(decideLoad({ verdict: 'tight', vramBytes: 22 * GIB, gpuBytes: 24 * GIB, gpuLayers: 'all', suggestion: null, offload: false })).toEqual({ go: true });
    expect(decideLoad({ verdict: 'unknown', vramBytes: 22 * GIB, gpuBytes: null, gpuLayers: 'all', suggestion: null, offload: false })).toEqual({ go: true });
  });

  it('refuses a model too big, saying what it needs, what the card has and what part could run on the processor', () => {
    const decided = decideLoad({ verdict: 'too-big', vramBytes: 23.1 * GIB, gpuBytes: 12 * GIB, gpuLayers: 'all', suggestion: 30, offload: false });
    expect(decided.go).toBe(false);
    const error = (decided as { error: ModelTooBigError }).error;
    expect(error).toBeInstanceOf(ModelTooBigError);
    expect(error).toMatchObject({ neededBytes: 23.1 * GIB, gpuBytes: 12 * GIB, gpuLayers: 30 });
    // Said to whoever reads it in English, never as « unknown ».
    expect(error.message).toMatch(/needs .* the card has/);
  });

  it('with « Une partie sur le processeur », goes with the layers that fit; with nothing that fits, still refuses', () => {
    expect(decideLoad({ verdict: 'too-big', vramBytes: 23 * GIB, gpuBytes: 12 * GIB, gpuLayers: 'all', suggestion: 30, offload: true })).toEqual({ go: true, gpuLayers: 30 });
    const none = decideLoad({ verdict: 'too-big', vramBytes: 23 * GIB, gpuBytes: 1 * GIB, gpuLayers: 'all', suggestion: null, offload: true });
    expect(none).toMatchObject({ go: false, error: { gpuLayers: null } });
  });

  it('goes when the person already put part of it on the processor: that was their choice, said before', () => {
    expect(decideLoad({ verdict: 'too-big', vramBytes: 23 * GIB, gpuBytes: 12 * GIB, gpuLayers: 20, suggestion: 30, offload: false })).toEqual({ go: true });
  });
});

describe('the disk nearly full, said before the memory is saved', () => {
  const MiB = 1024 ** 2;
  it('says nothing while the memory fits with its margin', () => {
    expect(planDiskRoom({ freeBytes: 2 * GIB, needBytes: 100 * MiB, saved: [] })).toBeNull();
  });

  it('names the oldest memories to let go, as few as make the room', () => {
    const saved = [
      { id: 'recent', bytes: 600 * MiB, at: '2026-11-18T10:00:00Z' },
      { id: 'oldest', bytes: 300 * MiB, at: '2026-11-10T10:00:00Z' },
      { id: 'older', bytes: 300 * MiB, at: '2026-11-12T10:00:00Z' },
    ];
    // 200 MiB free, 300 MiB to save, a margin of 512 MiB: 612 MiB to free — the two oldest are not enough, the three are.
    expect(planDiskRoom({ freeBytes: 200 * MiB, needBytes: 300 * MiB, saved })).toEqual({ release: ['oldest', 'older', 'recent'], enough: true });
    // 600 MiB free: 212 MiB to free, the oldest is enough.
    expect(planDiskRoom({ freeBytes: 600 * MiB, needBytes: 300 * MiB, saved })).toEqual({ release: ['oldest'], enough: true });
    // Nothing else to let go: said as it is.
    expect(planDiskRoom({ freeBytes: 10 * MiB, needBytes: 300 * MiB, saved: [] })).toEqual({ release: [], enough: false });
  });
});
