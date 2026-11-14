/**
 * What the window shows before a cost is paid — the product rule: nothing
 * expensive without announcing it first. Each announcement carries the
 * figures; the window writes the words.
 *
 * This file holds the load of a model (task 2.6); the others come with the
 * code that pays them (resume and re-read in 3.6, model switch and restart in
 * 7.4, downloads in 9.5, parallel slots in 8.3).
 */

import { estimateLoad, memoryVerdict, type MemoryVerdict } from '../models/cost.js';
import type { GgufInfo, KvCacheTypeName } from '../models/gguf.js';

export type Announcement =
  | { kind: 'restore'; tokens: number; seconds: number; insteadOfSeconds: number; bytes: number; savedAt: string }
  | {
      kind: 'reread';
      tokens: number;
      seconds: number;
      reason: 'evicted' | 'other-model' | 'cache-types' | 'context-too-small' | 'engine-died';
      compactSeconds?: number;
    }
  | {
      kind: 'model-switch';
      reloadSeconds: number;
      rereadTokens: number;
      rereadSeconds: number;
      vramBytes: number;
      vramBytesNow: number;
    }
  | { kind: 'context-full'; used: number; window: number; compactSeconds: number }
  | EngineLoadAnnouncement
  | { kind: 'restart'; setting: string }
  | { kind: 'download'; what: 'model' | 'llama.cpp'; bytes: number; seconds?: number }
  | { kind: 'parallel-slots'; slots: number; vramBytesEach: number };

export interface EngineLoadAnnouncement {
  kind: 'engine-load';
  seconds: number;
  /** No measure on this machine yet: the seconds are an estimate, and the window says so. */
  secondsEstimated: boolean;
  /** Video memory the load will take. */
  vramBytes: number;
  /** The card's; null when it was not measured — never zero. */
  gpuBytes: number | null;
  verdict: MemoryVerdict;
}

export interface LoadModel {
  info: GgufInfo;
  fileBytes: number;
  /** How long it took on this machine, last time (the measures). */
  loadSeconds?: number;
}

export interface LoadSettings {
  /** The context of each conversation. */
  nCtx: number;
  cacheType: KvCacheTypeName;
  gpuLayers: number | 'all';
}

export interface GpuMemory {
  totalBytes: number | null;
}

/**
 * Before any measure, how fast a model is read: about one GiB a second off a
 * solid-state disk, into the card. An estimate, and said to be one.
 */
const ESTIMATED_LOAD_BYTES_PER_SECOND = 1024 ** 3;
const MINIMUM_ESTIMATED_SECONDS = 2;

/** Video memory = the file + the context's KV cache + a margin, for the share of layers on the card. */
function vramFor(model: LoadModel, settings: LoadSettings) {
  const load = estimateLoad(model.info, model.fileBytes, settings.nCtx, settings.cacheType);
  const layers = model.info.blockCount;
  const share = settings.gpuLayers === 'all' || layers <= 0 ? 1 : Math.min(1, settings.gpuLayers / layers);
  return { load, vramBytes: (load.weightsBytes + load.kvBytes) * share + load.overheadBytes };
}

export function announceLoad(model: LoadModel, settings: LoadSettings, gpu: GpuMemory): EngineLoadAnnouncement {
  const { vramBytes } = vramFor(model, settings);
  const measured = model.loadSeconds;
  return {
    kind: 'engine-load',
    seconds:
      measured ??
      Math.max(MINIMUM_ESTIMATED_SECONDS, Math.round(model.fileBytes / ESTIMATED_LOAD_BYTES_PER_SECOND)),
    secondsEstimated: measured === undefined,
    vramBytes,
    gpuBytes: gpu.totalBytes,
    verdict: memoryVerdict(vramBytes, gpu.totalBytes ?? 0),
  };
}

/**
 * When the whole model does not fit on the card: how many of its layers do,
 * in proportion to its blocks (the rest runs on the processor, slower — the
 * window says so). Null when it fits whole, when nothing fits, or when the
 * card was not measured.
 */
export function suggestOffload(model: LoadModel, settings: LoadSettings, gpu: GpuMemory): { gpuLayers: number } | null {
  const total = gpu.totalBytes;
  if (total === null || !(total > 0)) return null;
  const { load, vramBytes } = vramFor(model, { ...settings, gpuLayers: 'all' });
  if (memoryVerdict(vramBytes, total) !== 'too-big') return null;
  const blocks = model.info.blockCount;
  if (blocks <= 0) return null;
  const perLayer = (load.weightsBytes + load.kvBytes) / blocks;
  const layers = Math.floor((total - load.overheadBytes) / perLayer);
  return layers >= 1 ? { gpuLayers: Math.min(layers, blocks - 1) } : null;
}
