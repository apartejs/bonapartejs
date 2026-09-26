/**
 * The cost of a model, said before it is paid — the product rule (D-03):
 * nothing expensive without announcing it first.
 *
 * Loading a model takes its weights (the file, memory-mapped), its KV cache
 * at the engine's context size and cache type (from the GGUF header), and
 * llama.cpp's compute buffers — a margin, not a measure. Switching a
 * conversation to another model reloads the server and computes the
 * conversation's context again: tokens we know, seconds only when a speed
 * was measured on this machine.
 */

import { kvBytesPerToken, kvCacheBytes, type GgufInfo, type KvCacheTypeName } from './gguf.js';

/** llama.cpp's compute buffers and friends: a few hundred MB at the default batch. A margin. */
const COMPUTE_MARGIN_BYTES = 512 * 1024 ** 2;

export interface LoadEstimate {
  weightsBytes: number;
  kvBytes: number;
  overheadBytes: number;
  totalBytes: number;
  kvBytesPerToken: number;
  /** The context asked for is larger than the one the model was trained for. */
  beyondTraining: boolean;
}

export function estimateLoad(
  info: GgufInfo,
  fileBytes: number,
  nCtx: number,
  cacheType: KvCacheTypeName,
): LoadEstimate {
  const weightsBytes = Math.round(fileBytes);
  const kvBytes = kvCacheBytes(info, nCtx, cacheType);
  return {
    weightsBytes,
    kvBytes,
    overheadBytes: COMPUTE_MARGIN_BYTES,
    totalBytes: weightsBytes + kvBytes + COMPUTE_MARGIN_BYTES,
    kvBytesPerToken: kvBytesPerToken(info, cacheType),
    beyondTraining: info.trainContext !== undefined && nCtx > info.trainContext,
  };
}

export type MemoryVerdict = 'fits' | 'tight' | 'too-big' | 'unknown';

/**
 * Against the machine's memory. The weights are memory-mapped and can sit
 * in VRAM or RAM; what is certain is that the whole must fit in the
 * memory the machine has. Past 80% it is tight (the OS and the other
 * programs need theirs), past 100% it will not load — or will swap.
 */
export function memoryVerdict(totalBytes: number, machineBytes: number): MemoryVerdict {
  if (!(machineBytes > 0)) return 'unknown';
  if (totalBytes > machineBytes) return 'too-big';
  if (totalBytes > machineBytes * 0.8) return 'tight';
  return 'fits';
}

export interface SwitchCost {
  /** Bytes read from disk to load the model. */
  readBytes: number;
  /** Seconds to load, when this model's load was measured on this machine. */
  loadSeconds?: number;
  /** Tokens of the conversation computed again on the new model. */
  reprefillTokens: number;
  /** Seconds for that, when a prefill speed was measured. */
  reprefillSeconds?: number;
}

export function estimateSwitch(input: {
  load: LoadEstimate;
  contextTokens: number;
  prefillTokensPerSecond?: number;
  loadSeconds?: number;
}): SwitchCost {
  const tokens = Math.max(0, Math.round(input.contextTokens));
  const speed = input.prefillTokensPerSecond;
  return {
    readBytes: input.load.weightsBytes,
    ...(input.loadSeconds !== undefined ? { loadSeconds: Math.round(input.loadSeconds) } : {}),
    reprefillTokens: tokens,
    ...(speed !== undefined && speed > 0 && tokens > 0 ? { reprefillSeconds: Math.round(tokens / speed) } : {}),
  };
}
