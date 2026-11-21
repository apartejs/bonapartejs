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
import { kvCacheBytes, type GgufInfo, type KvCacheTypeName } from '../models/gguf.js';

export type Announcement =
  | RestoreAnnouncement
  | RereadAnnouncement
  | ModelSwitchAnnouncement
  | { kind: 'context-full'; used: number; window: number; compactSeconds: number }
  | EngineLoadAnnouncement
  | RestartAnnouncement
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
 * another model, other cache settings or another number of slots, too big for
 * the context now, or the
 * engine died in the middle of the last answer.
 */
export type RereadReason =
  | 'evicted'
  | 'not-saved'
  | 'behind'
  | 'other-model'
  | 'cache-types'
  | 'context-too-small'
  /** Saved under another number of engine slots: llama.cpp keeps one KV stream a slot, and reads no other count. */
  | 'slots'
  | 'engine-died'
  /** Going back before a message: the prefix kept, from llama.cpp's nearest checkpoint (task 7.1). */
  | 'rewind';

export interface RereadAnnouncement {
  kind: 'reread';
  tokens: number;
  seconds: number;
  reason: RereadReason;
  /** A memory let go: when, and under which budget. */
  evicted?: { at: string; budgetBytes: number; byPerson?: true };
  /** `other-model`: the model the conversation's memory was made with — to go back to it (task 12.3). */
  savedWith?: string;
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
  /** The context it loads with (audit 2026-11-21, D2). */
  nCtx: number;
}

/**
 * Changing model (task 7.4; board « Coûts annoncés », 3): the reload, the conversation read again for the new
 * model, the video memory it takes against what the loaded one takes now (0 when none runs).
 */
export interface ModelSwitchAnnouncement {
  kind: 'model-switch';
  reloadSeconds: number;
  rereadTokens: number;
  rereadSeconds: number;
  vramBytes: number;
  vramBytesNow: number;
  /** The new model was never measured on this machine: the window says the figures are estimates. */
  estimated: boolean;
}

export function announceModelSwitch(facts: {
  /** What loading the new model costs. */
  load: EngineLoadAnnouncement;
  /** What the conversation's next turn reads on it. */
  rereadTokens: number;
  /** The new model's measured prefill speed. */
  prefillTokensPerSecond?: number;
  vramBytesNow: number;
}): ModelSwitchAnnouncement {
  const prefill = facts.prefillTokensPerSecond ?? DEFAULT_PREFILL_TOKENS_PER_SECOND;
  return {
    kind: 'model-switch',
    reloadSeconds: facts.load.seconds,
    rereadTokens: facts.rereadTokens,
    rereadSeconds: facts.rereadTokens / prefill,
    vramBytes: facts.load.vramBytes,
    vramBytesNow: facts.vramBytesNow,
    estimated: facts.load.secondsEstimated || (facts.rereadTokens > 0 && facts.prefillTokensPerSecond === undefined),
  };
}

/**
 * A setting that restarts the engine (task 7.4; board « Coûts annoncés », 6): the reload (none when nothing is
 * loaded — it applies at the next load), the memories saved it makes to read again, a reply that runs.
 */
export interface RestartAnnouncement {
  kind: 'restart';
  setting: string;
  reloadSeconds: number;
  estimated: boolean;
  memoriesLost: number;
  replyRunning: boolean;
  loaded: boolean;
  /** Sub-agents in parallel (task 8.3): the slot more, and what it holds (unknown with no model loaded). */
  /** `nCtx`: the context each slot keeps (audit C2); `nCtxBefore`: the one it had, when it drops; `vramBytesMore`:
   *  the video memory the relaunch takes more than the engine now. */
  parallel?: { slots: number; nCtx?: number; nCtxBefore?: number; vramBytesEach: number | null; vramBytesMore?: number | null };
}

/**
 * Sub-agents in parallel (task 8.3): one slot more, and what it holds — its whole KV cache, the windows of a
 * model with a sliding window included (the plan's « ~0.6 Go at 32 k » is the marginal cost only, a minimum).
 * The weights are paid once; the restart is said beside it (`announceRestart`).
 */
export function announceParallelSlots(
  info: GgufInfo,
  nCtx: number,
  cacheType: KvCacheTypeName,
): Extract<Announcement, { kind: 'parallel-slots' }> {
  return { kind: 'parallel-slots', slots: 2, vramBytesEach: kvCacheBytes(info, nCtx, cacheType) };
}

export function announceRestart(facts: {
  setting: string;
  loadSeconds: number;
  loadEstimated: boolean;
  memoriesLost: number;
  replyRunning: boolean;
  loaded: boolean;
}): RestartAnnouncement {
  return {
    kind: 'restart',
    setting: facts.setting,
    reloadSeconds: facts.loaded ? facts.loadSeconds : 0,
    estimated: facts.loaded && facts.loadEstimated,
    memoriesLost: facts.memoriesLost,
    replyRunning: facts.replyRunning,
    loaded: facts.loaded,
  };
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
  /** The slots the engine runs (task 8.3; one by default): each holds a KV cache of its own. */
  slots?: number;
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

/**
 * Video memory = the file + the KV cache of every slot + a margin, for the share of layers on the card. In
 * parallel (task 8.3) the engine runs two slots, each with the whole context: both are said (review of phase 8).
 */
function vramFor(model: LoadModel, settings: LoadSettings) {
  const load = estimateLoad(model.info, model.fileBytes, settings.nCtx, settings.cacheType);
  const layers = model.info.blockCount;
  const share = settings.gpuLayers === 'all' || layers <= 0 ? 1 : Math.min(1, settings.gpuLayers / layers);
  const slots = Math.max(1, settings.slots ?? 1);
  return { load, vramBytes: (load.weightsBytes + load.kvBytes * slots) * share + load.overheadBytes };
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
    nCtx: settings.nCtx,
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
/** A model's writing speed before any measure: what a summary takes to write. */
export const DEFAULT_GENERATION_TOKENS_PER_SECOND = 25;
export const DEFAULT_RESTORE_BYTES_PER_SECOND = 1024 ** 3;

export interface OpenFacts {
  /** The conversation already sits in the slot: nothing to pay. */
  resident: boolean;
  /** The tokens of its prompt: what a re-read reads. */
  promptTokens: number;
  /** Its saved state, when one can be restored. */
  saved: { promptTokenCount: number; slotFileBytes: number; savedAt: string } | null;
  /** Why it cannot be (the KV store's reason). */
  refusal: 'missing' | 'refused' | 'other-model' | 'cache-types' | 'context-too-small' | 'slots' | null;
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

