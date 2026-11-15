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
  | RestoreAnnouncement
  | RereadAnnouncement
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

/** `estimated`: no measure on this machine yet — the window says the figures are estimates. */
export interface RestoreAnnouncement {
  kind: 'restore';
  tokens: number;
  seconds: number;
  /** What re-reading the conversation would have taken instead. */
  insteadOfSeconds: number;
  bytes: number;
  savedAt: string;
  estimated: boolean;
}

/**
 * Why a conversation is read again: its memory let go under the budget
 * (`evicted`), never saved (`not-saved`), older than its last messages
 * (`behind`: its state is restored, and what came after is read), made for
 * another model or other cache settings, too big for the context now, or the
 * engine died in the middle of the last answer.
 */
export type RereadReason =
  | 'evicted'
  | 'not-saved'
  | 'behind'
  | 'other-model'
  | 'cache-types'
  | 'context-too-small'
  | 'engine-died';

export interface RereadAnnouncement {
  kind: 'reread';
  tokens: number;
  seconds: number;
  reason: RereadReason;
  /** A memory let go: when, and under which budget. */
  evicted?: { at: string; budgetBytes: number; byPerson?: true };
  compactSeconds?: number;
  estimated: boolean;
}

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

// ── Opening a conversation: its memory restored, or re-read (task 3.6) ──

/** Until this machine measured them: a modest card's prefill, an SSD's read. Said to be estimates. */
export const DEFAULT_PREFILL_TOKENS_PER_SECOND = 200;
export const DEFAULT_RESTORE_BYTES_PER_SECOND = 1024 ** 3;

export interface OpenFacts {
  /** The conversation already sits in the slot: nothing to pay. */
  resident: boolean;
  /** The tokens of its prompt: what a re-read reads. */
  promptTokens: number;
  /** Its saved state, when one can be restored. */
  saved: { promptTokenCount: number; slotFileBytes: number; savedAt: string } | null;
  /** Why it cannot be (the KV store's reason). */
  refusal: 'missing' | 'refused' | 'other-model' | 'cache-types' | 'context-too-small' | null;
  /** The saved state is older than the conversation's last entries: what came after must be read. */
  behind?: boolean;
  /** What came after it, estimated like the rest: what a restore leaves to read. */
  behindTokens?: number;
  /** The engine died in the middle of the last answer, after the state was saved. */
  diedMidAnswer?: boolean;
  /** A missing state that the budget let go: when, and under which budget. */
  evicted?: { at: string; budgetBytes: number; byPerson?: true } | null;
  measures: { prefillTokensPerSecond?: number; restoreBytesPerSecond?: number };
}

/** What opening a conversation will cost — said before the slot is touched. */
export function announceOpen(facts: OpenFacts): RestoreAnnouncement | RereadAnnouncement | null {
  if (facts.resident || facts.promptTokens <= 0) return null;
  const prefill = facts.measures.prefillTokensPerSecond ?? DEFAULT_PREFILL_TOKENS_PER_SECOND;
  const restorable = facts.saved !== null && facts.refusal === null;
  if (facts.saved && restorable && !facts.behind && !facts.diedMidAnswer) {
    const restore = facts.measures.restoreBytesPerSecond ?? DEFAULT_RESTORE_BYTES_PER_SECOND;
    return {
      kind: 'restore',
      tokens: facts.saved.promptTokenCount,
      seconds: facts.saved.slotFileBytes / restore,
      insteadOfSeconds: facts.saved.promptTokenCount / prefill,
      bytes: facts.saved.slotFileBytes,
      savedAt: facts.saved.savedAt,
      estimated: facts.measures.prefillTokensPerSecond === undefined || facts.measures.restoreBytesPerSecond === undefined,
    };
  }
  // A state that serves, but older than the conversation: it is restored, and what came after is read.
  const tokens =
    facts.saved && restorable
      ? (facts.behindTokens ?? Math.max(0, facts.promptTokens - facts.saved.promptTokenCount))
      : facts.promptTokens;
  const reason: RereadReason = facts.diedMidAnswer
    ? 'engine-died'
    : restorable
      ? 'behind'
      : facts.refusal === 'missing' || facts.refusal === 'refused' || facts.refusal === null
        ? facts.evicted && facts.refusal === 'missing'
          ? 'evicted'
          : 'not-saved'
        : facts.refusal;
  return {
    kind: 'reread',
    tokens,
    seconds: tokens / prefill,
    reason,
    ...(reason === 'evicted' && facts.evicted ? { evicted: facts.evicted } : {}),
    estimated: facts.measures.prefillTokensPerSecond === undefined,
  };
}

/** From 90 % of the window, the person is offered a compaction before the next message. */
export function announceContext(used: number, window: number, compactSeconds: number): Announcement | null {
  if (window <= 0 || used < window * 0.9) return null;
  return { kind: 'context-full', used, window, compactSeconds };
}

