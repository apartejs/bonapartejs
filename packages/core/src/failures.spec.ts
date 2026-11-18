/**
 * What breaks, said before anything is paid (task 12.3, board « Quand quelque chose casse »): a model too big for
 * the card is not loaded until the person chooses — part of it on the processor, or another model.
 */

import { describe, expect, it } from 'vitest';
import { decideLoad, ModelTooBigError } from './failures.js';

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
