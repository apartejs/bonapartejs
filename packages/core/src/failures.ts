/**
 * What breaks (task 12.3, board « Quand quelque chose casse »): each failure says what happened, what is safe, and
 * what can be done — in codes and figures; the window says them in the person's words. Never « unknown ».
 */

/** The model needs more video memory than the card has: nothing is loaded before the person chooses. */
export class ModelTooBigError extends Error {
  constructor(
    readonly neededBytes: number,
    readonly gpuBytes: number,
    /** The layers that fit on the card, the rest on the processor; null when not even one fits. */
    readonly gpuLayers: number | null,
  ) {
    const gib = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
    super(`The model needs ${gib(neededBytes)} of video memory; the card has ${gib(gpuBytes)}. Nothing was loaded.`);
    this.name = 'ModelTooBigError';
  }
}

export type LoadDecision = { go: true; gpuLayers?: number } | { go: false; error: ModelTooBigError };

/**
 * Whether a load goes: a model that fits, or whose fit is not known, goes; one too big goes only on the person's
 * « Une partie sur le processeur », with the layers that fit — or when they already chose a number of layers.
 */
export function decideLoad(input: {
  verdict: 'fits' | 'tight' | 'too-big' | 'unknown';
  vramBytes: number;
  gpuBytes: number | null;
  gpuLayers: number | 'all';
  suggestion: number | null;
  offload: boolean;
}): LoadDecision {
  if (input.verdict !== 'too-big' || input.gpuBytes === null || input.gpuLayers !== 'all') return { go: true };
  if (input.offload && input.suggestion !== null) return { go: true, gpuLayers: input.suggestion };
  return { go: false, error: new ModelTooBigError(input.vramBytes, input.gpuBytes, input.suggestion) };
}
