/**
 * A turn of a conversation on the built-in engine (spec §7, §7.10).
 *
 * - The system prompt is frozen once, in two system turns (`buildSystemPrompt`);
 *   each message and each answer is appended to the journal with the text it
 *   froze. The prompt of a turn is the journal's frozen text plus the new
 *   message: never rendered again.
 * - The slot is taken through the scheduler. A conversation that is not in
 *   it is restored from its KV state; without one, from the seed of its first
 *   system turn (prepared once, then shared); the rest is read again.
 * - Opening touches no slot: it says what the turn will cost.
 * - Never a context shift: a message that does not fit is refused before
 *   anything is sent. A message the server still refuses as too long is
 *   withdrawn. The engine dying keeps the message and the partial answer;
 *   Stop keeps what arrived.
 * - A server that already runs (no `live` config) has no memory on disk:
 *   nothing is saved, restored, or announced.
 */

import { randomUUID } from 'node:crypto';
import type { LlamaCppHttpClient } from '../backend/llamacpp/http-client.js';
import { LlamaCppHttpError } from '../backend/llamacpp/http-client.js';
import {
  announceContext,
  announceOpen,
  DEFAULT_GENERATION_TOKENS_PER_SECOND,
  DEFAULT_PREFILL_TOKENS_PER_SECOND,
  type Announcement,
  type RereadAnnouncement,
} from '../costs/announce.js';
import { createSlotScheduler, type SlotOwner, type SlotScheduler } from '../engine/slot-scheduler.js';
import type { MeasureStore } from '../engine/measures.js';
import { familyLayer } from '../families/index.js';
import type { DemuxEvent, FamilyLayer } from '../families/types.js';
import { KeyedQueue } from '../fs/json-file.js';
import { copyJournal, frozenPrompt, isRefrozen, openJournal } from '../journal/journal.js';
import type { Journal, JournalEntry, Outcome, PendingCall, Usage } from '../journal/types.js';
import { canRestore, type KvStore, type LiveConfig } from '../kv/kv-store.js';
import { rereadBeforeMessage } from '../kv/reread.js';
import { renderInstructionsDelta, renderInventoryDelta, renderModeDelta, renderPerimeterDelta, renderReplyLanguageDelta } from '../prompt/deltas.js';
import { buildSystemPrompt, type SystemPromptOptions } from '../prompt/system-prompt.js';
import { CompactionError, planCompaction, SUMMARY_MAX_TOKENS, SUMMARY_QUESTION, summaryNote } from './compact.js';
import type { ToolDef, ToolResult } from '../tools/types.js';
import type { ConversationMeta, ConversationStore } from './store.js';
import { branchModel, rerenderConversation } from './switch.js';
import type { PlayMode } from '@aparte/bonaparte-shared';

/** A rough count, for the checks made before the server's: about three characters a token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3) + 8;
}

/** Room kept for the answer: a message that leaves less is refused before it is sent. */
export const REPLY_ROOM = 1024;

/** A prefill shorter than this says little about the speed. */
const MEASURED_PREFILL_MIN = 64;

export interface EngineView {
  client: LlamaCppHttpClient;
  family: FamilyLayer;
  /** The managed engine's configuration — what a KV state is checked against; null: a server that already runs. */
  live: LiveConfig | null;
  /** What the measures are kept under. */
  modelPath: string;
  /** What a saved state will weigh, a token. */
  kvBytesPerToken: number | null;
  /** Which server: a relaunched one (after a crash, another model) is a new one, its slots empty. */
  generation: number;
  /**
   * The model's sliding window (GGUF), 0 or absent without one. llama.cpp then keeps only the window's last
   * tokens in those layers, and resumes a shorter prefix from a context checkpoint (task 7.0).
   */
  slidingWindow?: number;
}

export interface ConversationEngineDeps {
  store: ConversationStore;
  kv: KvStore;
  /** The engine a turn runs on; undefined when no model is loaded. */
  engine(): Promise<EngineView | undefined>;
  /** What the system prompt of a new conversation says: its tools, its folders, its reply language, its instructions. */
  prompt(meta: ConversationMeta): Omit<SystemPromptOptions, 'family'>;
  measures?: MeasureStore;
  slots?: number;
  /** A save that failed (a full disk, a state bigger than the budget): said, never dropped in silence. */
  onSaveError?(error: unknown, conversationId: string): void;
  /** The project's instructions now (its `.bonaparte/instructions.md`, `AGENTS.md` or `CLAUDE.md`). */
  instructions?(meta: ConversationMeta): Promise<string | undefined>;
  /** The mode the core decides the calls in (Impro not confirmed again after a restart runs as Plume); the card's by default. */
  mode?(meta: ConversationMeta): Promise<PlayMode>;
}

export type TurnEvent =
  | DemuxEvent
  /** What the turn waits for, said while it waits: the slot, a restore, a seed, a re-read. */
  | { type: 'step'; name: 'slot-wait' | 'restore' | 'seed' | 'reread'; phase: 'start' | 'end' }
  /** The prompt being read, as the server counts it. */
  | { type: 'progress'; done: number; total: number };

/** A call the model wrote, given an id: what the tool rounds answer. */
export interface ModelCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** What answers the calls of a round: their results, a pause for a person, or the end of the turn. */
export type CallsAnswer =
  | { results: ToolResult[] }
  /** A pause: the calls that wait, the ticket that resumes them, the results of those that ran before. */
  | { suspend: { pending: PendingCall[]; ticket: string; results?: ToolResult[] } }
  | { stop: 'limit' };

export interface TurnTools {
  /** The tools the model may call: their grammar goes with each completion. */
  defs: readonly ToolDef[];
  onCalls(calls: readonly ModelCall[]): Promise<CallsAnswer>;
}

export interface TurnInput {
  /** The person's message; absent: the last one is answered again (with `forkAfter`). */
  text?: string;
  /** The tool rounds: the model's calls are answered, and the turn goes on, in the same slot. */
  tools?: TurnTools;
  /** A paused turn goes on: its calls were answered; no message of the person, the model's answer continues. */
  resume?: true;
  messageId?: string;
  thinking?: boolean;
  /**
   * A branch first, after this entry: the last answer asked again (`retry`),
   * or a message changed (`edit`). What followed stays in the branch it was in.
   */
  forkAfter?: string;
}

/** One conversation's memory on disk (Settings, Engine and memory): where it is, what it holds, what reading it again costs. */
export interface MemoryRow {
  id: string;
  title: string;
  projectId: string | null;
  state: 'engine' | 'saved' | 'released';
  tokens: number;
  /** The slot file's size; null when none is kept. */
  bytes: number | null;
  /** When it was saved, or the conversation's last change. */
  at: string;
  /** Saved by another model than the one loaded: restored only under that one. */
  otherModel: boolean;
  /** For a released memory: what reading it again costs, in seconds. */
  rereadSeconds: number | null;
}

/** What the sidebar shows of a conversation (§12): where its memory is, and whether it waits for the person. */
export interface ConversationStatus {
  memory: 'engine' | 'saved' | 'reread' | null;
  waiting: boolean;
}

export interface TurnResult {
  usage: Usage;
  stopped?: 'user';
  /** The context ran out in the middle of the answer: it is incomplete. */
  truncated?: true;
  /** The turn waits for a person, or for the window: its calls, and the ticket that resumes it. */
  suspended?: { pending: PendingCall[]; ticket: string; results?: ToolResult[] };
  /** The tool rounds reached their limit. */
  limited?: true;
}

/** No model is loaded: nothing is loaded in silence (the window offers to). */
export class NoEngineError extends Error {
  constructor() {
    super('No model is loaded: choose one, or connect a service, before sending a message.');
    this.name = 'NoEngineError';
  }
}

/** The message does not fit: a compaction is offered instead of a context shift. */
export class ContextFullError extends Error {
  constructor(readonly announcement: Extract<Announcement, { kind: 'context-full' }>) {
    super(`The conversation is full: ${announcement.used} tokens used of ${announcement.window}.`);
    this.name = 'ContextFullError';
  }
}

/** The person's message to go back before, as the window shows it: its rank among their messages of the branch, and its text. */
export interface RewindTarget {
  userIndex: number;
  text: string;
}

/** What going back before a message would leave behind, read — nothing moved. */
export interface RewindLook {
  message: Extract<JournalEntry, { kind: 'user' }>;
  /** The message and everything after it, in this branch. */
  after: JournalEntry[];
  /** The turns of the person's messages before it (their aparté message ids). */
  earlier: string[];
  /** The entry the new branch starts after. */
  previousId: string;
}

/** What a compaction did: the summary, the turns folded and kept, the prompt before and after (tokens). */
export interface CompactResult {
  summary: string;
  compactedTurns: number;
  keptTurns: number;
  tokensBefore: number;
  tokensAfter: number;
}

export { CompactionError };

/** Tokens read again so few that the memory is said kept: « aucune relecture ». */
const KEPT_REREAD_TOKENS = 32;

/** The message the window names is not the one of this branch: nothing moves. */
export class RewindTargetError extends Error {
  constructor(target: RewindTarget) {
    super(`This branch has no message ${target.userIndex + 1} with that text: open the conversation again.`);
    this.name = 'RewindTargetError';
  }
}

function lookUp(entries: readonly JournalEntry[], target: RewindTarget): RewindLook {
  const users = entries.filter((entry): entry is Extract<JournalEntry, { kind: 'user' }> => entry.kind === 'user');
  const message = users[target.userIndex];
  const index = message ? entries.indexOf(message) : -1;
  if (!message || message.text !== target.text || index < 1) throw new RewindTargetError(target);
  return {
    message,
    after: entries.slice(index),
    earlier: users.slice(0, target.userIndex).flatMap((user) => (user.messageId ? [user.messageId] : [])),
    previousId: entries[index - 1]!.id,
  };
}

/** A going back the model has not heard of yet: told at the start of its next turn, as a note. */
async function tellRewind(journal: Journal, family: FamilyLayer): Promise<void> {
  const entries = journal.entries();
  const at = entries.findLastIndex((entry) => entry.kind === 'rewind');
  if (at < 0) return;
  const rewind = entries[at] as Extract<JournalEntry, { kind: 'rewind' }>;
  if (rewind.undo || !rewind.note) return;
  if (entries.slice(at + 1).some((entry) => entry.kind === 'delta' && entry.delta.kind === 'note')) return;
  await journal.append({ kind: 'delta', delta: { kind: 'note', text: rewind.note }, rendered: family.renderSystemNote(rewind.note) });
}

/** The engine failed in the middle of the answer: what arrived is kept, marked as such. */
export class EngineFailedError extends Error {
  constructor(readonly cause: unknown) {
    super(`The engine stopped in the middle of the answer: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'EngineFailedError';
  }
}

/** The server refused the prompt as longer than its context. */
function refusedAsTooLong(error: unknown): boolean {
  return error instanceof LlamaCppHttpError && error.status === 400 && /context size/i.test(error.message);
}

interface Turning {
  engine: EngineView;
  /** The conversation's first system turn, as frozen: what its seed holds. */
  stable: string;
  /** It has messages before this one: without its state, they are read again. */
  history: boolean;
  sink: (event: TurnEvent) => void;
  rereading: boolean;
  /** Its saved state is older than its last entries: restored, it leaves the rest to read. */
  behind: boolean;
}

/** Was this state saved before some of the conversation's entries — is it older than the conversation? */
function savedBefore(entries: readonly JournalEntry[], savedAt: string): boolean {
  return entries.some((entry) => entry.kind !== 'system' && entry.at > savedAt);
}

/** The text a state saved at `savedAt` leaves to read: what the entries after it froze into the prompt. */
function renderedAfter(entries: readonly JournalEntry[], savedAt: string): string {
  return entries
    .filter((entry) => entry.kind !== 'system' && entry.at > savedAt)
    .map((entry) => entry.rendered ?? '')
    .join('');
}

const ownerKey = (owner: SlotOwner): string =>
  owner.kind === 'conversation' ? `${owner.conversationId}_${owner.branchId}` : '';

export class ConversationEngine {
  private readonly exclusive = new KeyedQueue();
  private readonly scheduler: SlotScheduler;
  /** The turn under way of each conversation in the slot: what the restore hook needs. */
  private readonly turning = new Map<string, Turning>();
  /** What each conversation last ran on, and how big it was: what the save hook needs. */
  private readonly lastRun = new Map<string, { engine: EngineView; tokens: number }>();
  /** The server the slots' residents sit in. */
  private generation: number | undefined;

  constructor(private readonly deps: ConversationEngineDeps) {
    this.scheduler = createSlotScheduler({
      slots: deps.slots ?? 1,
      save: (owner, slot, incoming) => this.save(owner, slot, incoming),
      restore: (owner, slot) => this.restore(owner, slot),
      onError: (error, owner) => {
        if (owner.kind === 'conversation') this.deps.onSaveError?.(error, owner.conversationId);
      },
    });
  }

  /** What opening the conversation will cost — said before anything is paid; the slot is not touched. */
  async open(id: string): Promise<Announcement | null> {
    const meta = await this.deps.store.get(id);
    if (!meta) return null;
    const engine = await this.deps.engine();
    if (engine) this.follow(engine);
    if (!engine?.live) return null;
    const owner = this.ownerOf(meta);
    const entries = (await openJournal(this.deps.store.dir, id, meta.branchId)).entries();
    if (!entries.some((entry) => entry.kind === 'user')) return null;
    const last = entries.findLast((entry): entry is Extract<JournalEntry, { kind: 'assistant' }> => entry.kind === 'assistant');
    const key = ownerKey(owner);
    // Frozen for another model: whatever it saved, the conversation is rendered again and read (task 7.4).
    const switching = onAnotherModel(branchModel(entries), engine);
    const manifest = switching ? null : await this.deps.kv.manifest(key);
    let refusal: Parameters<typeof announceOpen>[0]['refusal'] = null;
    if (switching) refusal = 'other-model';
    else if (!manifest) refusal = 'missing';
    else {
      const verdict = canRestore(manifest, engine.live);
      if (!verdict.ok) refusal = verdict.reason;
    }
    const prompt = switching
      ? (await this.refreezeFor(meta, entries, engine, this.deps.instructions ? ((await this.deps.instructions(meta)) ?? '') : undefined)).rendered
      : frozenPrompt(entries);
    const prefill = this.deps.measures?.get(engine.modelPath)?.prefillTokensPerSecond;
    const announced = announceOpen({
      resident: !switching && this.scheduler.isResident(owner),
      promptTokens: estimateTokens(prompt),
      saved: refusal === null ? manifest : null,
      refusal,
      behind: manifest !== null && savedBefore(entries, manifest.savedAt),
      ...(manifest ? { behindTokens: estimateTokens(renderedAfter(entries, manifest.savedAt)) } : {}),
      diedMidAnswer: !switching && last?.stopped === 'engine' && (!manifest || manifest.savedAt < last.at),
      evicted: manifest ? null : await this.deps.kv.evicted(key),
      measures: prefill === undefined ? {} : { prefillTokensPerSecond: prefill },
    });
    // « Compacter d'abord »: the reading the summary needs, the summary written, and the short prompt read.
    if (announced?.kind === 'reread') return { ...announced, compactSeconds: announced.seconds + this.compactionTail(engine) };
    return announced;
  }

  /**
   * The context nearly full — from 90 % of the window —, said before a reply is cut (board « Coûts
   * annoncés », 4): with what compacting would take. Null below, or without a window known.
   */
  async contextOf(id: string): Promise<Extract<Announcement, { kind: 'context-full' }> | null> {
    const meta = await this.deps.store.get(id);
    if (!meta) return null;
    const engine = await this.deps.engine();
    if (!engine) return null;
    const entries = (await openJournal(this.deps.store.dir, id, meta.branchId)).entries();
    if (!entries.some((entry) => entry.kind === 'user')) return null;
    // The window as a turn reads it: the managed engine's, else the server's own.
    const engineWindow = engine.live?.nCtx || (await engine.client.props().catch(() => ({ nCtx: 0 }))).nCtx || Number.POSITIVE_INFINITY;
    const window = Math.min(meta.contextCap ?? Number.POSITIVE_INFINITY, engineWindow);
    if (!Number.isFinite(window)) return null;
    const used = estimateTokens(frozenPrompt(entries));
    // The summary reads a prompt its memory serves; then it is written, and the short prompt read.
    const announced = announceContext(used, window, this.compactionTail(engine));
    return announced?.kind === 'context-full' ? announced : null;
  }

  /** What a compaction takes once its prompt is read: the summary written, then the system turn and the summary read. */
  private compactionTail(engine: EngineView): number {
    const prefill = this.deps.measures?.get(engine.modelPath)?.prefillTokensPerSecond ?? DEFAULT_PREFILL_TOKENS_PER_SECOND;
    return SUMMARY_MAX_TOKENS / DEFAULT_GENERATION_TOKENS_PER_SECOND + (2 * SUMMARY_MAX_TOKENS) / prefill;
  }

  /**
   * What the sidebar shows of a conversation (§12), read without touching the slot: its memory —
   * in the engine, saved on disk, or to read again; none where nothing was said or with a server
   * that keeps no memory — and whether its last turn waits for the person.
   */
  async status(id: string): Promise<ConversationStatus | null> {
    const meta = await this.deps.store.get(id);
    if (!meta) return null;
    const entries = (await openJournal(this.deps.store.dir, id, meta.branchId)).entries();
    const waiting = entries.at(-1)?.kind === 'pending';
    const engine = await this.deps.engine();
    if (engine) this.follow(engine);
    if (!engine?.live || !entries.some((entry) => entry.kind === 'user')) return { memory: null, waiting };
    const owner = this.ownerOf(meta);
    if (this.scheduler.isResident(owner)) return { memory: 'engine', waiting };
    const manifest = await this.deps.kv.manifest(ownerKey(owner));
    const memory = manifest && canRestore(manifest, engine.live).ok ? 'saved' : 'reread';
    return { memory, waiting };
  }

  /**
   * The memory of every conversation where something was said, read without touching the slot:
   * none with a server that keeps no memory.
   */
  async memory(): Promise<MemoryRow[]> {
    const engine = await this.deps.engine();
    if (engine) this.follow(engine);
    if (!engine?.live) return [];
    const rows: MemoryRow[] = [];
    for (const meta of await this.deps.store.list()) {
      const entries = (await openJournal(this.deps.store.dir, meta.id, meta.branchId)).entries();
      if (!entries.some((entry) => entry.kind === 'user')) continue;
      const owner = this.ownerOf(meta);
      const manifest = await this.deps.kv.manifest(ownerKey(owner));
      const base = { id: meta.id, title: meta.title, projectId: meta.projectId ?? null, otherModel: false, rereadSeconds: null };
      if (this.scheduler.isResident(owner)) {
        rows.push({ ...base, state: 'engine', tokens: estimateTokens(frozenPrompt(entries)), bytes: manifest?.slotFileBytes ?? null, at: meta.updatedAt });
      } else if (manifest) {
        const verdict = canRestore(manifest, engine.live);
        rows.push({
          ...base,
          state: 'saved',
          tokens: manifest.promptTokenCount,
          bytes: manifest.slotFileBytes,
          at: manifest.savedAt,
          otherModel: !verdict.ok && verdict.reason === 'other-model',
        });
      } else {
        const announcement = await this.open(meta.id);
        rows.push({
          ...base,
          state: 'released',
          tokens: estimateTokens(frozenPrompt(entries)),
          bytes: null,
          at: meta.updatedAt,
          rereadSeconds: announcement?.kind === 'reread' ? announcement.seconds : null,
        });
      }
    }
    return rows;
  }

  /** « Libérer »: a saved memory let go by the person; never the one in the engine. */
  async release(id: string): Promise<void> {
    const meta = await this.deps.store.get(id);
    if (!meta) throw new Error(`There is no conversation ${id}.`);
    const owner = this.ownerOf(meta);
    if (this.scheduler.isResident(owner)) throw new Error(`The memory of ${id} is in the engine: it is not released.`);
    await this.deps.kv.release(ownerKey(owner));
  }

  turn(id: string, input: TurnInput, sink: (event: TurnEvent) => void, signal?: AbortSignal): Promise<TurnResult> {
    return this.exclusive.run(id, () => this.runTurn(id, input, sink, signal));
  }

  /** The person's message the window names, and what came after it — read, nothing moved (task 7.1). */
  async lookBefore(id: string, target: RewindTarget): Promise<RewindLook> {
    const meta = await this.deps.store.get(id);
    if (!meta) throw new Error(`There is no conversation ${id}.`);
    return lookUp((await openJournal(this.deps.store.dir, id, meta.branchId)).entries(), target);
  }

  /**
   * Going back before a message (task 7.1): for the conversation, a new branch that starts before it —
   * the branch it leaves saved first, its state given to the new one; for the code only, the branch stays.
   * Either way the going back is written down, with what the model will be told of it.
   */
  rewindTo(
    id: string,
    target: RewindTarget,
    what: 'both' | 'conversation' | 'code',
    note?: string,
  ): Promise<{ fromBranchId: string; branchId: string }> {
    return this.exclusive.run(id, async () => {
      let meta = await this.deps.store.get(id);
      if (!meta) throw new Error(`There is no conversation ${id}.`);
      let journal = await openJournal(this.deps.store.dir, id, meta.branchId);
      const look = lookUp(journal.entries(), target);
      const fromBranchId = meta.branchId;
      if (what !== 'code') ({ meta, journal } = await this.fork(meta, journal, look.previousId));
      await journal.append({ kind: 'rewind', toEntryId: look.message.id, what, fromBranchId, ...(note ? { note } : {}), rendered: '' });
      return { fromBranchId, branchId: meta.branchId };
    });
  }

  /**
   * What going back before a message will cost its memory (task 7.1), said before: kept when llama.cpp
   * resumes where the message began — a few tokens; otherwise what it will read again. Null without an
   * engine that keeps a memory.
   */
  async rewindMemory(id: string, target: RewindTarget): Promise<'kept' | RereadAnnouncement | null> {
    const meta = await this.deps.store.get(id);
    if (!meta) throw new Error(`There is no conversation ${id}.`);
    const engine = await this.deps.engine();
    if (engine) this.follow(engine);
    if (!engine?.live) return null;
    const entries = (await openJournal(this.deps.store.dir, id, meta.branchId)).entries();
    const look = lookUp(entries, target);
    const index = entries.indexOf(look.message);
    const kept = entries.slice(0, index);
    const prefixTokens = estimateTokens(frozenPrompt(kept));
    const measured = this.deps.measures?.get(engine.modelPath)?.prefillTokensPerSecond;
    const prefill = measured ?? DEFAULT_PREFILL_TOKENS_PER_SECOND;
    const reread = (tokens: number, reason: RereadAnnouncement['reason']): RereadAnnouncement => ({
      kind: 'reread',
      tokens,
      seconds: tokens / prefill,
      reason,
      estimated: measured === undefined,
    });
    // Back to where the prompt was frozen for another model: rendered again for this one, and read (task 7.4).
    if (onAnotherModel(branchModel(kept), engine)) {
      const instructions = this.deps.instructions ? ((await this.deps.instructions(meta)) ?? '') : undefined;
      return reread(estimateTokens((await this.refreezeFor(meta, kept, engine, instructions)).rendered), 'other-model');
    }
    const owner = this.ownerOf(meta);
    if (!this.scheduler.isResident(owner)) {
      const manifest = await this.deps.kv.manifest(ownerKey(owner));
      if (!manifest) return reread(prefixTokens, 'evicted');
      const verdict = canRestore(manifest, engine.live);
      if (!verdict.ok) return reread(prefixTokens, verdict.reason);
    }
    const previous = kept.findLast((entry): entry is Extract<JournalEntry, { kind: 'assistant' }> => entry.kind === 'assistant');
    const opened = previous ? kept.indexOf(previous) + 1 : 0;
    const tokens = rereadBeforeMessage({
      slidingWindow: engine.slidingWindow ?? 0,
      prefixTokens,
      // What the message's request appended to what the slot held: its notes and the message (and the opening).
      segmentTokens: estimateTokens(entries.slice(opened, index + 1).map((entry) => entry.rendered ?? '').join('')) + 4,
      previousAnswerTokens: previous?.usage?.outputTokens ?? estimateTokens(previous?.raw ?? ''),
      // Up to two a request (one answer each), one a saved state (counted once a message: more is safer).
      checkpointsSince:
        look.after.filter((entry) => entry.kind === 'assistant').length * 2 + look.after.filter((entry) => entry.kind === 'user').length,
    });
    return tokens <= KEPT_REREAD_TOKENS ? 'kept' : reread(tokens, 'rewind');
  }

  /**
   * Compaction (task 7.3): the model summarises the conversation — asked as the conversation itself, its
   * memory serving the prefix —, then a rebase. Nothing changes on a summary cut or empty, or when it is not
   * worth it (CompactionError). The slot, which holds the old prompt and the question, is never saved as the
   * conversation's memory, and its saved memory is let go: the next turn reads from the rebase.
   */
  compact(id: string, sink: (event: TurnEvent) => void, signal?: AbortSignal): Promise<CompactResult> {
    return this.exclusive.run(id, async () => {
      const meta = await this.deps.store.get(id);
      if (!meta) throw new Error(`There is no conversation ${id}.`);
      const engine = await this.deps.engine();
      if (!engine) throw new NoEngineError();
      this.follow(engine);
      const { family, client } = engine;
      const journal = await openJournal(this.deps.store.dir, id, meta.branchId);
      const entries = journal.entries();
      const plan = planCompaction(entries, estimateTokens);
      const frozen = frozenPrompt(entries);
      const question = family.renderUser(SUMMARY_QUESTION) + family.beginAssistant({ thinking: false });
      const engineWindow = engine.live?.nCtx || (await client.props()).nCtx || Number.POSITIVE_INFINITY;
      const window = Math.min(meta.contextCap ?? Number.POSITIVE_INFINITY, engineWindow);
      const used = estimateTokens(frozen + question);
      const nPredict = Math.min(SUMMARY_MAX_TOKENS, Math.floor(window - used - 64));
      if (nPredict < 256) throw new CompactionError('no-room', 'There is no room left in the context for a summary: nothing was compacted.');

      const owner = this.ownerOf(meta);
      const key = ownerKey(owner);
      const saved = engine.live ? await this.deps.kv.manifest(key) : null;
      this.turning.set(key, {
        engine,
        stable: stableOf(entries),
        history: true,
        sink,
        rereading: false,
        behind: saved !== null && savedBefore(entries, saved.savedAt),
      });
      this.lastRun.set(key, { engine, tokens: used });
      let summary = '';
      let cut = false;
      try {
        await this.scheduler.run(
          owner,
          async (slot) => {
            const demux = family.createDemux();
            const take = (pieces: DemuxEvent[]): void => {
              for (const piece of pieces) if (piece.type === 'text') summary += piece.delta;
            };
            for await (const event of client.complete({
              prompt: frozen + question,
              idSlot: slot.id,
              cachePrompt: true,
              nPredict,
              sampling: { stop: [...family.stop] },
              ...(signal ? { signal } : {}),
            })) {
              if (event.type === 'token') take(demux.push(event.text));
              else if (event.type === 'done') cut = event.stats.truncated || event.stats.predictedTokens >= nPredict;
            }
            take(demux.flush());
          },
          signal ? { signal } : {},
        );
      } finally {
        this.turning.delete(key);
        // The slot holds the old prompt and the question: never saved as this conversation's memory.
        this.scheduler.evict(owner);
        this.lastRun.delete(key);
      }
      if (cut) throw new CompactionError('cut', 'The summary was cut before its end: nothing was compacted.');
      summary = summary.trim();
      if (!summary) throw new CompactionError('empty', 'The summary came back empty: nothing was compacted.');

      // The system prompt frozen again, with the truth of the moment: every note folded in.
      const instructions = this.deps.instructions ? ((await this.deps.instructions(meta)) ?? '') : undefined;
      const asked = this.deps.prompt(meta);
      const prompt = buildSystemPrompt({ ...asked, family, ...(instructions ? { projectInstructions: instructions } : {}) });
      const stable = family.renderSystem(prompt.stable);
      const rendered =
        stable +
        family.renderSystemNote(prompt.project) +
        family.renderSystemNote(summaryNote(summary)) +
        plan.kept.map((entry) => entry.rendered ?? '').join('');
      await journal.append({
        kind: 'rebase',
        summary,
        ...(plan.kept[0] ? { keptFrom: plan.kept[0].id } : {}),
        stable,
        replyLanguage: asked.replyLanguage,
        perimeter: [...asked.perimeter],
        tools: [...asked.tools],
        rendered,
      });
      if (instructions !== undefined) await this.deps.store.update(id, { instructions });
      // The memory of the old prompt serves nothing any more.
      await this.deps.kv.forget(key);
      return {
        summary,
        compactedTurns: plan.compactedTurns,
        keptTurns: plan.keptTurns,
        tokensBefore: estimateTokens(frozen),
        tokensAfter: estimateTokens(rendered),
      };
    });
  }

  /**
   * « Restaurer » a compaction (aparté's checkpoint): the conversation goes on from before its last rebase,
   * on a new branch — its early turns read again (no memory holds that prompt any more). The branch it
   * leaves keeps the rebase. Returns the branch shown now.
   */
  uncompact(id: string): Promise<string> {
    return this.exclusive.run(id, async () => {
      const meta = await this.deps.store.get(id);
      if (!meta) throw new Error(`There is no conversation ${id}.`);
      const journal = await openJournal(this.deps.store.dir, id, meta.branchId);
      const entries = journal.entries();
      const rebase = entries.findLastIndex((entry) => entry.kind === 'rebase');
      if (rebase < 1) return meta.branchId;
      const { meta: moved } = await this.fork(meta, journal, entries[rebase - 1]!.id);
      return moved.branchId;
    });
  }

  /** « Annuler le retour »: the branch it left active again — or, for the code only, nothing told to the model. */
  undoRewind(id: string, rewound: NonNullable<ConversationMeta['rewound']>): Promise<void> {
    return this.exclusive.run(id, async () => {
      const meta = await this.deps.store.get(id);
      if (!meta) throw new Error(`There is no conversation ${id}.`);
      if (rewound.what !== 'code') {
        await this.deps.store.update(id, { branchId: rewound.fromBranchId });
        return;
      }
      const journal = await openJournal(this.deps.store.dir, id, meta.branchId);
      const last = journal.entries().findLast((entry): entry is Extract<JournalEntry, { kind: 'rewind' }> => entry.kind === 'rewind');
      if (last) {
        await journal.append({ kind: 'rewind', toEntryId: last.toEntryId, what: 'code', fromBranchId: rewound.fromBranchId, undo: true, rendered: '' });
      }
    });
  }

  /** Another branch of the conversation shown and continued (« Brancher », a sibling picked): one it has. */
  switchBranch(id: string, branchId: string): Promise<ConversationMeta> {
    return this.exclusive.run(id, async () => {
      const meta = await this.deps.store.get(id);
      if (!meta) throw new Error(`There is no conversation ${id}.`);
      const branches = await (await openJournal(this.deps.store.dir, id, meta.branchId)).branches();
      if (!branches.some((branch) => branch.branchId === branchId)) throw new Error(`The conversation ${id} has no branch ${branchId}.`);
      return meta.branchId === branchId ? meta : this.deps.store.update(id, { branchId });
    });
  }

  /** What a paused turn waits for: its last entry, when it is a pause. */
  async paused(id: string): Promise<Extract<JournalEntry, { kind: 'pending' }> | null> {
    const meta = await this.deps.store.get(id);
    if (!meta) return null;
    const last = (await openJournal(this.deps.store.dir, id, meta.branchId)).entries().at(-1);
    return last?.kind === 'pending' ? last : null;
  }

  /**
   * The answers to a pause, kept in the journal: the outcomes as they came,
   * the results the model reads (rendered — and disarmed — by the family),
   * and a new pause when one of the calls must wait again.
   */
  recordAnswers(
    id: string,
    answers: { outcomes: Record<string, Outcome>; results: readonly ToolResult[]; pending?: { calls: PendingCall[]; ticket: string } },
  ): Promise<void> {
    return this.exclusive.run(id, async () => {
      const meta = await this.deps.store.get(id);
      if (!meta) throw new Error(`There is no conversation ${id}.`);
      const engine = await this.deps.engine();
      if (!engine) throw new NoEngineError();
      const journal = await openJournal(this.deps.store.dir, id, meta.branchId);
      await journal.append({ kind: 'outcomes', outcomes: answers.outcomes, rendered: '' });
      if (answers.results.length > 0) {
        await journal.append({ kind: 'tool-results', results: [...answers.results], rendered: engine.family.renderToolResults(answers.results) });
      }
      if (answers.pending) await journal.append({ kind: 'pending', calls: answers.pending.calls, ticket: answers.pending.ticket, rendered: '' });
    });
  }

  /** Saves the conversations whose state changed (the app closes). */
  async flush(): Promise<void> {
    // Only an engine that keeps a memory is asked which server it is: a remote one is never joined to close.
    if ([...this.lastRun.values()].some((run) => run.engine.live)) {
      const engine = await this.deps.engine();
      if (engine) this.follow(engine);
    }
    return this.scheduler.flush();
  }

  /**
   * A server relaunched — by itself after a crash, or for another model —
   * holds nothing: its slots' residents are forgotten, none saved over the
   * memory on disk, and the next turn restores what it needs.
   */
  private follow(engine: EngineView): void {
    if (this.generation !== undefined && engine.generation !== this.generation) {
      this.scheduler.reset();
      this.lastRun.clear();
    }
    this.generation = engine.generation;
  }

  /**
   * A conversation removed whole — its journal, its card, the states of its
   * branches — once its turn under way has ended; nothing of it is saved after.
   */
  remove(id: string): Promise<void> {
    return this.exclusive.run(id, async () => {
      const meta = await this.deps.store.get(id);
      if (!meta) return;
      const branches = await (await openJournal(this.deps.store.dir, id, meta.branchId)).branches();
      for (const { branchId } of branches) {
        const owner: SlotOwner = { kind: 'conversation', conversationId: id, branchId };
        this.scheduler.evict(owner);
        this.lastRun.delete(ownerKey(owner));
        await this.deps.kv.forget(ownerKey(owner));
      }
      await this.deps.store.remove(id);
    });
  }

  private ownerOf(meta: ConversationMeta): SlotOwner {
    return { kind: 'conversation', conversationId: meta.id, branchId: meta.branchId };
  }

  /**
   * A new branch after `afterEntryId`. The branch it comes from is saved
   * first, and its state given to the new one: the new answer is served by
   * the cache up to the branch point.
   */
  private async fork(
    meta: ConversationMeta,
    journal: Journal,
    afterEntryId: string,
    options: { memory?: boolean } = {},
  ): Promise<{ meta: ConversationMeta; journal: Journal }> {
    const parent = this.ownerOf(meta);
    // What sits in the slot is saved first — never at the cost of the state the branch starts from.
    await this.scheduler.flush(parent);
    const branch = await journal.fork(afterEntryId);
    const child: SlotOwner = { kind: 'conversation', conversationId: meta.id, branchId: branch.branchId };
    // A change of model starts from nothing: the state of the branch left is the old model's.
    if (options.memory !== false) await this.deps.kv.copyState(ownerKey(parent), ownerKey(child));
    return { meta: await this.deps.store.update(meta.id, { branchId: branch.branchId }), journal: branch };
  }

  /**
   * What a change of model would freeze (task 7.4): the system prompt frozen again for the engine's family,
   * with the truth of the moment, then the conversation rendered again by that family.
   */
  private async refreezeFor(
    meta: ConversationMeta,
    entries: readonly JournalEntry[],
    engine: Pick<EngineView, 'family'>,
    instructions: string | undefined,
  ) {
    const { family } = engine;
    const asked = this.deps.prompt(meta);
    const prompt = buildSystemPrompt({ ...asked, family, ...(instructions ? { projectInstructions: instructions } : {}) });
    const stable = family.renderSystem(prompt.stable);
    const written = branchModel(entries).family;
    const rendered = rerenderConversation(entries, {
      to: family,
      head: stable + family.renderSystemNote(prompt.project),
      from: written ? familyLayer(written) : family,
    });
    return { asked, stable, rendered };
  }

  /**
   * What the conversation's next turn would read on `target` (task 7.4: the cost of changing model, said
   * before): rendered again for it when its branch is frozen for another model; nothing when its memory is
   * saved; else its frozen prompt. Nothing for a conversation with no message yet.
   */
  async rereadOn(id: string, target: Pick<EngineView, 'family' | 'modelPath'>): Promise<number> {
    const meta = await this.deps.store.get(id);
    if (!meta) return 0;
    const entries = (await openJournal(this.deps.store.dir, id, meta.branchId)).entries();
    if (!entries.some((entry) => entry.kind === 'user')) return 0;
    if (onAnotherModel(branchModel(entries), target)) {
      const instructions = this.deps.instructions ? ((await this.deps.instructions(meta)) ?? '') : undefined;
      return estimateTokens((await this.refreezeFor(meta, entries, target, instructions)).rendered);
    }
    return (await this.deps.kv.manifest(ownerKey(this.ownerOf(meta)))) ? 0 : estimateTokens(frozenPrompt(entries));
  }

  /**
   * « Brancher sur ce modèle » (task 7.4): a new conversation from the branch shown — its entries, the window's
   * document — opened by a change of model to `target`; the original keeps its model and its memory. A
   * worktree belongs to one conversation: the copy works in the project's folder, its prompt says so.
   */
  copy(id: string, target: Pick<EngineView, 'family' | 'modelPath'>): Promise<ConversationMeta> {
    return this.exclusive.run(id, async () => {
      const meta = await this.deps.store.get(id);
      if (!meta) throw new Error(`There is no conversation ${id}.`);
      const created = await this.deps.store.create({
        kind: meta.kind,
        engineId: meta.engineId,
        modelId: target.modelPath,
        mode: meta.mode,
        ...(meta.projectId ? { projectId: meta.projectId } : {}),
        ...(meta.title ? { title: meta.title } : {}),
      });
      const document = await this.deps.store.loadDocument(id);
      if (document && typeof document === 'object') await this.deps.store.saveDocument(created.id, { ...document, id: created.id });
      const journal = await copyJournal(this.deps.store.dir, { conversationId: id, branchId: meta.branchId }, created.id);
      const entries = journal.entries();
      if (!entries.some((entry) => entry.kind === 'system')) return created;
      const instructions = this.deps.instructions ? ((await this.deps.instructions(created)) ?? '') : undefined;
      const { asked, stable, rendered } = await this.refreezeFor(created, entries, target, instructions);
      await journal.append({
        kind: 'engine',
        engineId: created.engineId,
        modelId: target.modelPath,
        family: target.family.id,
        stable,
        replyLanguage: asked.replyLanguage,
        perimeter: [...asked.perimeter],
        tools: [...asked.tools],
        rendered,
      });
      return instructions === undefined ? created : this.deps.store.update(created.id, { instructions });
    });
  }

  /**
   * A change of model (task 7.4): a new branch after the last entry — the memory not carried: the branch left
   * keeps it, for the old model —, opened by an `engine` entry that freezes the prompt again for the new one.
   */
  private async changeModel(
    meta: ConversationMeta,
    journal: Journal,
    engine: EngineView,
    instructions: string | undefined,
  ): Promise<{ meta: ConversationMeta; journal: Journal }> {
    const entries = journal.entries();
    const last = entries.at(-1);
    const moved = last ? await this.fork(meta, journal, last.id, { memory: false }) : { meta, journal };
    const { asked, stable, rendered } = await this.refreezeFor(moved.meta, entries, engine, instructions);
    await moved.journal.append({
      kind: 'engine',
      engineId: meta.engineId,
      modelId: engine.modelPath ?? '',
      family: engine.family.id,
      stable,
      replyLanguage: asked.replyLanguage,
      perimeter: [...asked.perimeter],
      tools: [...asked.tools],
      rendered,
    });
    const updated = await this.deps.store.update(meta.id, {
      ...(engine.modelPath ? { modelId: engine.modelPath } : {}),
      ...(instructions !== undefined ? { instructions } : {}),
    });
    return { meta: updated, journal: moved.journal };
  }

  private async runTurn(id: string, input: TurnInput, sink: (event: TurnEvent) => void, signal?: AbortSignal): Promise<TurnResult> {
    let meta = await this.deps.store.get(id);
    if (!meta) throw new Error(`There is no conversation ${id}.`);
    const engine = await this.deps.engine();
    if (!engine) throw new NoEngineError();
    this.follow(engine);
    const { family, client } = engine;
    let journal = await openJournal(this.deps.store.dir, id, meta.branchId);
    if (input.forkAfter) ({ meta, journal } = await this.fork(meta, journal, input.forkAfter));
    // Each answer names the window's message it fills: the sibling the person picks is found by it.
    const answerOf = input.messageId ? { messageId: input.messageId } : {};

    const instructions = this.deps.instructions ? ((await this.deps.instructions(meta)) ?? '') : undefined;
    // A branch frozen for another model goes on in a new branch, the conversation rendered again (task 7.4).
    if (onAnotherModel(branchModel(journal.entries()), engine)) {
      ({ meta, journal } = await this.changeModel(meta, journal, engine, instructions));
    }
    if (!journal.entries().some((entry) => entry.kind === 'system')) {
      const asked = this.deps.prompt(meta);
      const prompt = buildSystemPrompt({ ...asked, family, ...(instructions ? { projectInstructions: instructions } : {}) });
      await journal.append({
        kind: 'system',
        rendered: family.renderSystem(prompt.stable),
        replyLanguage: asked.replyLanguage,
        perimeter: [...asked.perimeter],
        tools: [...asked.tools],
        ...(engine.modelPath ? { modelId: engine.modelPath } : {}),
        family: family.id,
      });
      await journal.append({ kind: 'system', rendered: family.renderSystemNote(prompt.project) });
      if (instructions !== undefined) meta = await this.deps.store.update(id, { instructions });
    }
    // A model turn left open by calls nobody answered (a limit, a pause given up): closed before any note.
    if (!input.resume) await closeOpenTurn(journal, family);
    if (!input.resume) {
      // A going back the model has not heard of is told now; once a turn begins it cannot be undone.
      await tellRewind(journal, family);
      if (meta.rewound) meta = await this.deps.store.update(id, { rewound: undefined });
    }
    if (!input.resume && instructions !== undefined && instructions !== (meta.instructions ?? '')) {
      // The instructions changed since the model read them: a note, appended — the frozen text stays as it was.
      // Never on a resume: the answer it continues is still open.
      const delta = renderInstructionsDelta(meta.instructions ?? '', instructions);
      if (delta) await journal.append({ kind: 'delta', delta, rendered: family.renderSystemNote(delta.text) });
      meta = await this.deps.store.update(id, { instructions });
    }
    if (!input.resume) {
      // The core's tools changed (a plugin came or went, or was turned off for the project): told by a note.
      const current = [...this.deps.prompt(meta).tools];
      const told = lastToldTools(journal.entries());
      const delta = told === undefined ? null : renderInventoryDelta(told, current);
      if (delta) await journal.append({ kind: 'delta', delta: { ...delta, tools: current }, rendered: family.renderSystemNote(delta.text) });
    }
    if (!input.resume && input.tools) {
      // The tools the window runs (ask_user) are not in the frozen prompt: told by a note when they change.
      const windowTools = input.tools.defs.filter((tool) => tool.where === 'window');
      const delta = renderInventoryDelta(lastToldWindowTools(journal.entries()), windowTools);
      if (delta) await journal.append({ kind: 'delta', delta: { ...delta, windowTools }, rendered: family.renderSystemNote(delta.text) });
    }
    if (!input.resume) {
      // The mode the calls are decided in, told when it is not the one the model last read (Répétition until told).
      const running = this.deps.mode ? await this.deps.mode(meta) : meta.mode;
      const told = lastToldMode(journal.entries());
      if (running !== told) {
        // Leaving Lecture launches a plan only when one was presented since the model was told Lecture.
        const launched = told === 'lecture' && running !== 'lecture' && planSinceLecture(journal.entries());
        const delta = renderModeDelta(running, launched);
        await journal.append({ kind: 'delta', delta, rendered: family.renderSystemNote(delta.text) });
      }
    }
    if (!input.resume) {
      // The project's folders changed (one added, one removed): told by a note, the frozen text untouched.
      const current = [...this.deps.prompt(meta).perimeter];
      const told = lastToldPerimeter(journal.entries());
      const delta = told === undefined ? null : renderPerimeterDelta(told, current);
      if (delta) await journal.append({ kind: 'delta', delta: { ...delta, roots: current }, rendered: family.renderSystemNote(delta.text) });
    }
    if (!input.resume) {
      // The person changed the language of the interface: the replies follow it, told by a note.
      const current = this.deps.prompt(meta).replyLanguage;
      const told = lastToldReplyLanguage(journal.entries());
      const delta = told === undefined || !current ? null : renderReplyLanguageDelta(told, current);
      if (delta) await journal.append({ kind: 'delta', delta: { ...delta, language: current }, rendered: family.renderSystemNote(delta.text) });
    }
    const entries = journal.entries();
    const stable = stableOf(entries);
    const frozen = frozenPrompt(entries);
    // Answering the last message again appends no message.
    const userRendered = input.text === undefined ? '' : family.renderUser(input.text);
    const opening = family.beginAssistant({ thinking: input.thinking ?? true, ...(input.resume ? { continuing: true } : {}) });

    // Never a context shift: what does not fit is refused before anything is sent.
    const engineWindow = engine.live?.nCtx || (await client.props()).nCtx || Number.POSITIVE_INFINITY;
    const window = Math.min(meta.contextCap ?? Number.POSITIVE_INFINITY, engineWindow);
    const used = estimateTokens(frozen + userRendered + opening);
    if (used + REPLY_ROOM > window) throw new ContextFullError(this.contextFull(engine, used, window));

    const user =
      input.text === undefined
        ? null
        : await journal.append({
            kind: 'user',
            text: input.text,
            rendered: userRendered,
            ...(input.messageId ? { messageId: input.messageId } : {}),
          });
    const owner = this.ownerOf(meta);
    const key = ownerKey(owner);
    const saved = engine.live ? await this.deps.kv.manifest(key) : null;
    const turning: Turning = {
      engine,
      stable,
      history: entries.some((entry) => entry.kind === 'user'),
      sink,
      rereading: false,
      behind: saved !== null && savedBefore(entries, saved.savedAt),
    };
    this.turning.set(key, turning);
    this.lastRun.set(key, { engine, tokens: used });

    const waits = this.scheduler.busy.length > 0;
    if (waits) sink({ type: 'step', name: 'slot-wait', phase: 'start' });
    try {
      return await this.scheduler.run(
        owner,
        async (slot) => {
          if (waits) sink({ type: 'step', name: 'slot-wait', phase: 'end' });
          const grammar = input.tools ? family.toolGrammar(input.tools.defs) : null;
          let prompt = frozen + userRendered + opening;
          let roundOpening = opening;
          let usage: Usage = { inputTokens: 0, outputTokens: 0 };
          const finishReread = (): void => {
            if (!turning.rereading) return;
            turning.rereading = false;
            sink({ type: 'step', name: 'reread', phase: 'end' });
          };
          // One completion a round; a round that ends on calls is answered, and the next round reads the results.
          for (let round = 0; ; round += 1) {
            const demux = family.createDemux();
            let raw = '';
            let truncated = false;
            let finished = false;
            const calls: ModelCall[] = [];
            const take = (piece: DemuxEvent): void => {
              if (piece.type === 'tool-call') calls.push({ id: `call-${randomUUID()}`, name: piece.name, input: piece.input });
              sink(piece);
            };
            try {
              for await (const event of client.complete({
                prompt,
                idSlot: slot.id,
                cachePrompt: true,
                returnProgress: true,
                sampling: { stop: [...family.stop] },
                ...(grammar ?? {}),
                ...(signal ? { signal } : {}),
              })) {
                if (event.type === 'token') {
                  finishReread();
                  raw += event.text;
                  for (const piece of demux.push(event.text)) take(piece);
                } else if (event.type === 'progress') {
                  sink({ type: 'progress', done: event.progress.processed, total: event.progress.total });
                } else {
                  finished = true;
                  const { stats } = event;
                  usage = {
                    inputTokens: stats.progress?.total ?? stats.promptUncachedTokens,
                    outputTokens: stats.predictedTokens,
                    cacheReadTokens: stats.progress?.cache ?? 0,
                  };
                  this.measure(engine, stats.promptUncachedTokens, stats.promptMs);
                  this.lastRun.set(key, { engine, tokens: stats.contextTokens || used });
                  truncated = stats.truncated === true;
                }
              }
              for (const piece of demux.flush()) take(piece);
              finishReread();
              // The stream ended without its final event: the person stopped it (it may end quietly then),
              // or the engine went away.
              if (!finished) {
                throw signal?.aborted
                  ? new DOMException('The answer was stopped.', 'AbortError')
                  : new Error('The engine ended its answer before finishing it.');
              }
            } catch (error) {
              finishReread();
              if (signal?.aborted) {
                await journal.append({ kind: 'assistant', raw, stopped: 'user', ...answerOf, rendered: roundOpening + raw + family.endAssistant(raw) });
                return { usage, stopped: 'user' as const };
              }
              if (refusedAsTooLong(error)) {
                // The server read nothing of it: the slot holds what it held. The person's message is taken
                // back when it is what did not fit; after tool rounds, what they gave stays.
                slot.unchanged();
                if (user && round === 0) await journal.append({ kind: 'withdrawn', entryId: user.id });
                throw new ContextFullError(this.contextFull(engine, round === 0 ? used : estimateTokens(prompt), window));
              }
              await journal.append({ kind: 'assistant', raw, stopped: 'engine', ...answerOf, rendered: roundOpening + raw + family.endAssistant(raw) });
              // What the slot held is gone with the engine: nothing of it is saved.
              this.scheduler.evict(owner);
              throw new EngineFailedError(error);
            }
            await journal.append({
              kind: 'assistant',
              raw,
              usage,
              ...answerOf,
              ...(truncated ? { truncated: true as const } : {}),
              rendered: roundOpening + raw + family.endAssistant(raw),
            });
            if (!input.tools || calls.length === 0 || truncated) {
              return truncated ? { usage, truncated: true as const } : { usage };
            }

            const answer = await input.tools.onCalls(calls);
            if ('stop' in answer) return { usage, limited: true as const };
            if ('suspend' in answer) {
              // What ran before the pause is kept; the calls that wait enter the prompt once answered (4.5).
              const ran = answer.suspend.results ?? [];
              if (ran.length > 0) await journal.append({ kind: 'tool-results', results: ran, rendered: family.renderToolResults(ran) });
              await journal.append({ kind: 'pending', calls: answer.suspend.pending, ticket: answer.suspend.ticket, rendered: '' });
              return { usage, suspended: answer.suspend };
            }
            // The results, disarmed by the family as it renders them, then the model's answer goes on.
            await journal.append({ kind: 'tool-results', results: answer.results, rendered: family.renderToolResults(answer.results) });
            roundOpening = family.beginAssistant({ thinking: input.thinking ?? true, continuing: true });
            prompt = frozenPrompt(journal.entries()) + roundOpening;
          }
        },
        signal ? { signal } : {},
      );
    } catch (error) {
      // Stopped while it waited for the slot: the message stays, with an empty answer stopped by the person.
      if (signal?.aborted && error instanceof DOMException && error.name === 'AbortError') {
        await journal.append({ kind: 'assistant', raw: '', stopped: 'user', ...answerOf, rendered: opening + family.endAssistant('') });
        return { usage: { inputTokens: 0, outputTokens: 0 }, stopped: 'user' };
      }
      throw error;
    } finally {
      this.turning.delete(key);
    }
  }

  private contextFull(engine: EngineView, used: number, window: number): Extract<Announcement, { kind: 'context-full' }> {
    const prefill = this.deps.measures?.get(engine.modelPath)?.prefillTokensPerSecond ?? DEFAULT_PREFILL_TOKENS_PER_SECOND;
    return { kind: 'context-full', used, window, compactSeconds: used / prefill };
  }

  private measure(engine: EngineView, uncached: number, promptMs: number): void {
    const measures = this.deps.measures;
    if (!measures || uncached < MEASURED_PREFILL_MIN || !(promptMs > 0)) return;
    const speed = uncached / (promptMs / 1000);
    const before = measures.get(engine.modelPath)?.prefillTokensPerSecond;
    measures.record(engine.modelPath, { prefillTokensPerSecond: before === undefined ? speed : (before + speed) / 2 });
  }

  /** The slot hook: the conversation arriving gets its state, else its seed; what is missing is read again. */
  private async restore(owner: SlotOwner, slotId: number): Promise<void> {
    const turning = this.turning.get(ownerKey(owner));
    const live = turning?.engine.live;
    if (!turning || !live) return;
    const { client, kvBytesPerToken } = turning.engine;
    const { kv } = this.deps;
    turning.sink({ type: 'step', name: 'restore', phase: 'start' });
    const restored = await kv.restoreState(client, slotId, ownerKey(owner), live);
    turning.sink({ type: 'step', name: 'restore', phase: 'end' });
    if (restored.restored) {
      // A state older than the conversation: what came after it is read now, and said.
      if (turning.behind && turning.history) {
        turning.rereading = true;
        turning.sink({ type: 'step', name: 'reread', phase: 'start' });
      }
      return;
    }

    turning.sink({ type: 'step', name: 'seed', phase: 'start' });
    try {
      const key = kv.seedKey(turning.stable, live);
      const seeded = await kv.restoreSeed(client, slotId, key, live);
      if (!seeded.restored && turning.stable) {
        // The first conversation of its kind prepares the seed: its first system turn, read once and kept.
        for await (const _ of client.complete({ prompt: turning.stable, idSlot: slotId, cachePrompt: true, nPredict: 0 })) {
          // Only the reading matters.
        }
        await kv.saveSeed(client, slotId, key, live, {
          expectedBytes: estimateTokens(turning.stable) * (kvBytesPerToken ?? 0),
        });
      }
    } catch {
      // A seed that fails costs the seed only: the turn reads its prompt.
    }
    turning.sink({ type: 'step', name: 'seed', phase: 'end' });
    if (turning.history) {
      turning.rereading = true;
      turning.sink({ type: 'step', name: 'reread', phase: 'start' });
    }
  }

  /**
   * The slot hook: the conversation leaving is saved, room made first for
   * what it will weigh — never at the cost of the state of the one arriving.
   */
  /**
   * Before a conversation's state is saved, on a model with a sliding window: its prompt read once more to the
   * end of its last answer, nothing generated. llama.cpp puts a context checkpoint where such a reading starts,
   * and never in what it generated: the state saved then ends on one, and coming back reads a few tokens
   * again — not the whole last answer. A reading that fails costs only that.
   */
  private async settle(owner: Extract<SlotOwner, { kind: 'conversation' }>, slotId: number, client: LlamaCppHttpClient): Promise<void> {
    try {
      const prompt = frozenPrompt((await openJournal(this.deps.store.dir, owner.conversationId, owner.branchId)).entries());
      if (!prompt) return;
      for await (const _ of client.complete({ prompt, idSlot: slotId, cachePrompt: true, nPredict: 0 })) {
        // Only the reading matters.
      }
    } catch {
      // The state is saved as it is.
    }
  }

  private async save(owner: SlotOwner, slotId: number, incoming?: SlotOwner): Promise<void> {
    const last = this.lastRun.get(ownerKey(owner));
    const live = last?.engine.live;
    if (!last || !live) return;
    // The slot of a server that went away holds nothing of this conversation.
    if ((await this.deps.engine())?.generation !== last.engine.generation) return;
    if (owner.kind === 'conversation' && (last.engine.slidingWindow ?? 0) > 0) await this.settle(owner, slotId, last.engine.client);
    await this.deps.kv.saveState(last.engine.client, slotId, ownerKey(owner), live, {
      expectedBytes: last.tokens * (last.engine.kvBytesPerToken ?? 0),
      keep: incoming?.kind === 'conversation' ? [ownerKey(incoming)] : [],
    });
  }
}

/** The mode the model last read in this branch: its last note of the mode, else Répétition (the frozen prompt names none). */
/**
 * A branch frozen for another model than the engine's (task 7.4): another model file, or — for a journal older
 * than the record, which knows only its family — another family.
 */
function onAnotherModel(model: ReturnType<typeof branchModel>, engine: Pick<EngineView, 'family' | 'modelPath'>): boolean {
  // A server that already runs names no model file: only its family is known.
  if (model.modelId && engine.modelPath) return model.modelId !== engine.modelPath;
  return model.family !== undefined && model.family !== engine.family.id;
}

function lastToldMode(entries: readonly JournalEntry[]): PlayMode {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === 'delta' && entry.delta.kind === 'mode' && entry.delta.mode) return entry.delta.mode;
    // A rebase or a change of model froze the system prompt again, which names no mode: told again.
    if (isRefrozen(entry)) break;
  }
  return 'repetition';
}

/** The folders the model last read of in this branch: its last note of them, else the frozen prompt's. */
function lastToldPerimeter(entries: readonly JournalEntry[]): string[] | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === 'delta' && entry.delta.kind === 'perimeter' && entry.delta.roots) return entry.delta.roots;
    if ((entry.kind === 'system' || isRefrozen(entry)) && entry.perimeter) return entry.perimeter;
  }
  return undefined;
}

/**
 * The reply language the model last read in this branch: its last note of it, else the frozen
 * prompt's; unknown for a conversation older than the record (then nothing is told).
 */
function lastToldReplyLanguage(entries: readonly JournalEntry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === 'delta' && entry.delta.kind === 'reply-language' && entry.delta.language) return entry.delta.language;
    if ((entry.kind === 'system' || isRefrozen(entry)) && entry.replyLanguage) return entry.replyLanguage;
  }
  return undefined;
}

/**
 * The system turn the branch's prompt starts from (a seed is keyed by it): its last rebase's or change of
 * model's, else its first.
 */
function stableOf(entries: readonly JournalEntry[]): string {
  const refrozen = entries.findLast(isRefrozen);
  return refrozen?.stable ?? entries.find((entry) => entry.kind === 'system')?.rendered ?? '';
}

/** The window's tools the model last read of in this branch: the last note of them, else none. */
/** The core's tools the model last read: undefined for a journal older than the record (nothing told then). */
function lastToldTools(entries: readonly JournalEntry[]): ToolDef[] | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === 'delta' && entry.delta.tools) return entry.delta.tools;
    if ((entry.kind === 'system' || isRefrozen(entry)) && entry.tools) return entry.tools;
  }
  return undefined;
}

function lastToldWindowTools(entries: readonly JournalEntry[]): ToolDef[] {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === 'delta' && entry.delta.windowTools) return entry.delta.windowTools;
    // A rebase or a change of model froze the system prompt again, without the window's tools: told again.
    if (isRefrozen(entry)) break;
  }
  return [];
}

/** What the model reads of a call its turn left unanswered: the conversation moved on without it. */
export const NOT_RUN_UNANSWERED = 'Not run: the turn ended before this call was answered.';

/**
 * A model turn that ended on calls nobody answered — the round limit reached, a pause the person
 * left — is closed before the next message: each call answered as not run, then the turn closed,
 * so the prompt keeps the template's shape (a Gemma turn that ended on a call is still open).
 */
async function closeOpenTurn(journal: Journal, family: FamilyLayer): Promise<void> {
  const last = journal.entries().at(-1);
  let open: { toolCallId: string; name: string }[];
  if (last?.kind === 'pending') {
    open = last.calls.map((call) => ({ toolCallId: call.toolCallId, name: call.name }));
  } else if (last?.kind === 'tool-results') {
    // The results are there, the continuation never came (it did not fit, the engine failed): only the close.
    open = [];
  } else if (last?.kind === 'assistant' && family.endAssistant(last.raw) === '') {
    const demux = family.createDemux();
    open = [...demux.push(last.raw), ...demux.flush()]
      .filter((piece): piece is Extract<DemuxEvent, { type: 'tool-call' }> => piece.type === 'tool-call')
      .map((piece) => ({ toolCallId: `call-${randomUUID()}`, name: piece.name }));
  } else {
    return;
  }
  const results: ToolResult[] = open.map((call) => ({ ...call, content: NOT_RUN_UNANSWERED, failed: true }));
  if (results.length > 0) await journal.append({ kind: 'tool-results', results, rendered: family.renderToolResults(results) });
  await journal.append({
    kind: 'assistant',
    raw: '',
    stopped: 'user',
    rendered: family.beginAssistant({ thinking: false, continuing: true }) + family.endAssistant(''),
  });
}

/** Did the model present a plan (an update_plan that ran) since its last note of Lecture, in this branch? */
function planSinceLecture(entries: readonly JournalEntry[]): boolean {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === 'delta' && entry.delta.kind === 'mode') return false;
    if (entry.kind === 'tool-results' && entry.results.some((result) => result.name === 'update_plan' && !result.failed)) {
      // A plan — when the mode told before it is Lecture.
      for (let back = index - 1; back >= 0; back -= 1) {
        const earlier = entries[back]!;
        if (earlier.kind === 'delta' && earlier.delta.kind === 'mode') return earlier.delta.mode === 'lecture';
      }
      return false;
    }
  }
  return false;
}

