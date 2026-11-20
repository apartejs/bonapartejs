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
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
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
import { createSlotScheduler, type SlotHandle, type SlotOwner, type SlotScheduler } from '../engine/slot-scheduler.js';
import type { MeasureStore } from '../engine/measures.js';
import { familyLayer } from '../families/index.js';
import type { DemuxEvent, FamilyLayer } from '../families/types.js';
import { KeyedQueue } from '../fs/json-file.js';
import { copyJournal, frozenPrompt, isRefrozen, openJournal } from '../journal/journal.js';
import { unreadAnswer } from './inbox.js';
import type { Journal, JournalEntry, NewJournalEntry, Outcome, PendingCall, SubagentHold, Usage } from '../journal/types.js';
import { canRestore, type KvStore, type LiveConfig } from '../kv/kv-store.js';
import { rereadBeforeMessage } from '../kv/reread.js';
import { renderInstructionsDelta, renderInventoryDelta, renderModeDelta, renderPerimeterDelta, renderReplyLanguageDelta } from '../prompt/deltas.js';
import { buildSystemPrompt, type SystemPromptOptions } from '../prompt/system-prompt.js';
import { cutInstructions, instructionsBudget, sameInstructions } from '../project/instructions.js';
import { CompactionError, planCompaction, planCompactionKeeping, planTurnFold, SUMMARY_MAX_TOKENS, SUMMARY_QUESTION, SUMMARY_TURN_QUESTION, summaryNote } from './compact.js';
import type { ToolDef, ToolResult } from '../tools/types.js';
import type { ConversationMeta, ConversationStore } from './store.js';
import { branchModel, rerenderConversation } from './switch.js';
import type { PlayMode } from '@aparte/bonaparte-shared';

/** A rough count, for the checks made before the server's: about three characters a token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3) + 8;
}

/**
 * What a branch holds, as the engine counted it after its last answer — the gauge's figure —, with an
 * estimate only for what was frozen since (results, a message, notes). Null when no answer since the
 * prompt was last frozen again (a rebase, a change of model) carries the engine's count.
 */
export function countedContext(entries: readonly JournalEntry[]): number | null {
  const boundary = Math.max(0, entries.findLastIndex(isRefrozen));
  const at = entries.findLastIndex(
    (entry, index) => index > boundary && entry.kind === 'assistant' && (entry.usage?.contextTokens ?? 0) > 0,
  );
  if (at < 0) return null;
  const counted = (entries[at] as Extract<JournalEntry, { kind: 'assistant' }>).usage!.contextTokens!;
  const since = entries.slice(at + 1).map((entry) => entry.rendered ?? '').join('');
  return counted + (since ? Math.ceil(since.length / 3) : 0);
}

/** A context this small or smaller: a turn does not reason unless its conversation says so (audit 2026-11-21, I2). */
export const SMALL_CONTEXT = 16_384;

/** Whether a turn reasons when nothing says: not on a small context, where its thoughts would eat the room left. */
export function defaultThinking(window: number): boolean {
  return window > SMALL_CONTEXT;
}

/**
 * How a compaction is made: `slot`, in the slot the turn under way holds; `keepFrom`, everything from that entry kept as
 * it was frozen; `foldRounds`, the turn under way folded on itself — its message and its last round kept, its earlier
 * rounds in the summary (review of round 2, 5).
 */
interface CompactOptions {
  sink: (event: TurnEvent) => void;
  window: number;
  signal?: AbortSignal;
  slot?: { id: number };
  keepFrom?: string;
  foldRounds?: boolean;
}

/** What an answer of the model wrote. */
function rawOf(entry: JournalEntry): string {
  return entry.kind === 'assistant' ? entry.raw : '';
}

/** What opened the model's turn of an answer, as it was frozen: its rendering before what it wrote. */
function openingOf(answer: Extract<JournalEntry, { kind: 'assistant' }>, family: FamilyLayer): string {
  const rendered = answer.rendered ?? '';
  const written = answer.raw + family.endAssistant(answer.raw);
  return rendered.endsWith(written) ? rendered.slice(0, rendered.length - written.length) : family.beginAssistant({ thinking: false });
}

/** A model a conversation may go to: its family, its file, and the context it runs with when it is known (tokens). */
export type ModelTarget = Pick<EngineView, 'family' | 'modelPath'> & { nCtx?: number };

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
  /** The slots the server runs (task 8.3): two when sub-agents work in parallel; one by default. */
  slots?: number;
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
  /** How much a sub-agent may reason in one answer before it is cut (characters; `SUBAGENT_THINKING_CHARS`). */
  subagentThinkingChars?: number;
  /** A save that failed (a full disk, a state bigger than the budget): said, never dropped in silence. */
  onSaveError?(error: unknown, conversationId: string): void;
  /** The project's instructions now (its `.bonaparte/instructions.md`, `AGENTS.md` or `CLAUDE.md`). */
  instructions?(meta: ConversationMeta): Promise<string | undefined>;
  /**
   * This conversation's environment, rendered (`renderEnvironment`: the date, the branch, what is not committed):
   * read only when its prompt is frozen — its first turn, a compaction, a change of model — into its own turn,
   * never into the shared one (audit 2026-11-21, I1).
   */
  environment?(meta: ConversationMeta): Promise<string | undefined>;
  /** The mode the core decides the calls in (Impro not confirmed again after a restart runs as Plume); the card's by default. */
  mode?(meta: ConversationMeta): Promise<PlayMode>;
}

export type TurnEvent =
  | DemuxEvent
  /** What the turn waits for, said while it waits: the slot, a restore, a seed, a re-read. */
  | { type: 'step'; name: 'slot-wait' | 'restore' | 'seed' | 'reread'; phase: 'start' | 'end' }
  /** The prompt being read, as the server counts it. */
  | { type: 'progress'; done: number; total: number }
  /**
   * The context ran out: the conversation is compacted on its own before the turn goes on (audit 2026-11-21, D2) —
   * said as it starts, then what it held before and after (tokens), or nothing when it could not be.
   */
  | { type: 'compaction'; phase: 'start' }
  | { type: 'compaction'; phase: 'end'; before?: number; after?: number }
  /**
   * The model is called again within the turn, after its tools answered: a new turn on the wire (`turn-start`), so
   * that what it thinks and writes now is a block of its own — aparté appends to the last block until then. The
   * turn's first call is said by whoever opened the run (the handler; a sub-agent's `agent-start`).
   */
  | { type: 'round' };

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
  | { suspend: { pending: PendingCall[]; ticket: string; results?: ToolResult[]; subagents?: SubagentHold[] } }
  | { stop: 'limit' };

export interface TurnTools {
  /** The tools the model may call: their grammar goes with each completion. */
  defs: readonly ToolDef[];
  /** `slot`: the slot the conversation's turn holds — lent to its sub-agents (task 8.1); none for a sub-agent's own calls. */
  onCalls(calls: readonly ModelCall[], slot?: CallsSlot): Promise<CallsAnswer>;
}

/** What a round's calls may do with the slot their turn holds: lend it to a sub-agent, which the turn takes back after. */
export interface CallsSlot {
  lend: SlotHandle['lend'];
}

/** A sub-agent's turn (task 8.1): its first, after its note and its mission, or its pause answered. */
export interface SubagentTurnInput {
  /** Its first turn: its note (who it is, what it may use) and its mission, after its conversation's first system turn. */
  start?: { note: string; mission: string };
  /** Its pause was answered: it goes on. */
  resume?: true;
  tools: TurnTools;
  thinking?: boolean;
  /** Its conversation's temperature (task 12.4). */
  temperature?: number;
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
  /** The conversation's own temperature (task 12.4); none: the engine's. */
  temperature?: number;
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
  /** A reply finished since the window last showed it (task 8.4): « Pas encore lu ». */
  unread: boolean;
}

export interface TurnResult {
  usage: Usage;
  stopped?: 'user';
  /** The context ran out in the middle of the answer: it is incomplete. */
  truncated?: true;
  /** The turn waits for a person, or for the window: its calls, and the ticket that resumes it. */
  suspended?: { pending: PendingCall[]; ticket: string; results?: ToolResult[]; subagents?: SubagentHold[] };
  /** The tool rounds reached their limit. */
  limited?: true;
  /** The model reasoned past this many characters in one answer without acting: the answer was cut (sub-agents). */
  overthought?: number;
}

/**
 * A sub-agent's reasoning in one answer, at most (characters, about 8,000 tokens): nobody watches it, and a small
 * model can muse until the context is full. Past it, the answer is cut and the main agent told.
 */
export const SUBAGENT_THINKING_CHARS = 32_000;

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
  /** The whole branch: who wrote each entry (a change of model may stand in it) is read from its start. */
  branch: readonly JournalEntry[];
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
    branch: entries,
  };
}

/**
 * A fork that starts among the turns the branch's last compaction kept (review of phase 7): the branch keeps the
 * compaction — its text without the kept turns (the head), and the kept turns up to the fork point, copied
 * after it. Null when the fork point is elsewhere: before what the compaction folded, or after it.
 */
function keptCut(
  entries: readonly JournalEntry[],
  afterEntryId: string,
): { rebase: Extract<JournalEntry, { kind: 'rebase' }>; head: string; copies: readonly JournalEntry[] } | null {
  const at = entries.findIndex((entry) => entry.id === afterEntryId);
  const rebaseAt = entries.findLastIndex((entry) => entry.kind === 'rebase');
  if (at < 0 || rebaseAt < 0 || at >= rebaseAt || entries.slice(rebaseAt + 1).some(isRefrozen)) return null;
  const rebase = entries[rebaseAt] as Extract<JournalEntry, { kind: 'rebase' }>;
  const keptAt = rebase.keptFrom ? entries.findIndex((entry) => entry.id === rebase.keptFrom) : -1;
  // A turn folded on itself kept only some of its entries: a fork there starts from before the compaction.
  if (keptAt < 0 || at < keptAt - 1 || rebase.keptRound) return null;
  const keptText = entries
    .slice(keptAt, rebaseAt)
    .map((entry) => entry.rendered ?? '')
    .join('');
  const rendered = rebase.rendered ?? '';
  if (!rendered.endsWith(keptText)) return null;
  return { rebase, head: rendered.slice(0, rendered.length - keptText.length), copies: entries.slice(keptAt, at + 1) };
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
/**
 * A state saved before text the branch froze since: older than its conversation. Only text counts — a going
 * back, a pause, an answer to it freeze none (task 7.5: a going back was said as a re-reading the restore served).
 */
function savedBefore(entries: readonly JournalEntry[], savedAt: string): boolean {
  return entries.some((entry) => entry.kind !== 'system' && (entry.rendered ?? '') !== '' && entry.at > savedAt);
}

/** The text a state saved at `savedAt` leaves to read: what the entries after it froze into the prompt. */
function renderedAfter(entries: readonly JournalEntry[], savedAt: string): string {
  return entries
    .filter((entry) => entry.kind !== 'system' && entry.at > savedAt)
    .map((entry) => entry.rendered ?? '')
    .join('');
}

const ownerKey = (owner: SlotOwner): string =>
  owner.kind === 'conversation'
    ? `${owner.conversationId}_${owner.branchId}`
    : owner.kind === 'subagent'
      ? `${owner.conversationId}_${owner.agentId}`
      : '';

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

  /** The sub-agent working in the engine now, by its name (task 8.2: « Occupé : sous-agent … »); none: null. */
  get subagentAtWork(): string | null {
    const owner = this.scheduler.busy.find((busy) => busy.kind === 'subagent');
    return owner?.kind === 'subagent' ? owner.name : null;
  }

  /** Told each time the sub-agent at work changes: its name, or null when none works any more. */
  onSubagentAtWork(listener: (name: string | null) => void): () => void {
    let last = this.subagentAtWork;
    return this.scheduler.onChange(() => {
      const now = this.subagentAtWork;
      if (now === last) return;
      last = now;
      listener(now);
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
    // Made with another model: which one, to go back to it (task 12.3).
    const savedWith = switching ? branchModel(entries).modelId : undefined;
    if (announced?.kind === 'reread') {
      return { ...announced, compactSeconds: announced.seconds + this.compactionTail(engine), ...(savedWith ? { savedWith } : {}) };
    }
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
    // The engine's count, as the gauge beside it shows; an estimate only before an answer carries one.
    const used = countedContext(entries) ?? estimateTokens(frozenPrompt(entries));
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
    const unread = unreadAnswer(entries, meta) !== null;
    // On a service (task 9.3): no memory is kept, whatever the built-in engine holds.
    if (meta.engineId !== 'builtin') return { memory: null, waiting, unread };
    const engine = await this.deps.engine();
    if (engine) this.follow(engine);
    if (!engine?.live || !entries.some((entry) => entry.kind === 'user')) return { memory: null, waiting, unread };
    const owner = this.ownerOf(meta);
    if (this.scheduler.isResident(owner)) return { memory: 'engine', waiting, unread };
    const manifest = await this.deps.kv.manifest(ownerKey(owner));
    const memory = manifest && canRestore(manifest, engine.live).ok ? 'saved' : 'reread';
    return { memory, waiting, unread };
  }

  /**
   * The conversations whose memory is for this model file (task 13.1): the tokens of each, read again one by one
   * once the file changes. Those that keep no memory cost nothing more than they already do.
   */
  async keptFor(modelPath: string): Promise<number[]> {
    const same = (a: string, b: string): boolean =>
      process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
    const tokens: number[] = [];
    for (const meta of await this.deps.store.list()) {
      if (meta.engineId !== 'builtin') continue;
      const entries = await openJournal(this.deps.store.dir, meta.id, meta.branchId)
        .then((journal) => journal.entries())
        .catch(() => null);
      if (!entries?.some((entry) => entry.kind === 'user')) continue;
      // The model its prompt was frozen for: the journal says it, the card only names the one it was made on.
      const model = branchModel(entries).modelId || meta.modelId;
      if (!model || !same(model, modelPath)) continue;
      const owner = this.ownerOf(meta);
      // In the engine: kept there, or its turn holds the slot right now.
      const working = this.scheduler.busy.some((one) => one.kind === 'conversation' && one.conversationId === meta.id);
      if (working || this.scheduler.isResident(owner)) {
        tokens.push(estimateTokens(frozenPrompt(entries)));
        continue;
      }
      const manifest = await this.deps.kv.manifest(ownerKey(owner));
      if (manifest) tokens.push(manifest.promptTokenCount);
    }
    return tokens;
  }

  /** The window shows the conversation (task 8.4): what it finished so far is read. Not activity: the list keeps its order. */
  async markSeen(id: string): Promise<void> {
    if (await this.deps.store.get(id)) await this.deps.store.mark(id, { seenAt: new Date().toISOString() });
  }

  /**
   * « Relire et continuer » (task 8.4): the conversation read again now, nothing generated — its saved state
   * restored, else its seed, then the rest of its prompt read — so that going on costs nothing more.
   */
  async readAgain(id: string, sink: (event: TurnEvent) => void = () => undefined, signal?: AbortSignal): Promise<void> {
    const meta = await this.deps.store.get(id);
    if (!meta) throw new Error(`There is no conversation ${id}.`);
    const engine = await this.deps.engine();
    if (!engine) throw new NoEngineError();
    this.follow(engine);
    const entries = (await openJournal(this.deps.store.dir, id, meta.branchId)).entries();
    // Frozen for another model: read on this one, it would serve nothing and be saved over that model's memory.
    // Its next message changes model, and says what that costs (review of phase 8).
    if (onAnotherModel(branchModel(entries), engine)) return;
    const prompt = frozenPrompt(entries);
    if (!prompt) return;
    const owner = this.ownerOf(meta);
    const key = ownerKey(owner);
    const used = countedContext(entries) ?? estimateTokens(prompt);
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
    try {
      await this.scheduler.run(
        owner,
        async (slot) => {
          for await (const event of engine.client.complete({ prompt, idSlot: slot.id, cachePrompt: true, nPredict: 0, returnProgress: true, ...(signal ? { signal } : {}) })) {
            if (event.type === 'progress') sink({ type: 'progress', done: event.progress.processed, total: event.progress.total });
          }
        },
        signal ? { signal } : {},
      );
    } finally {
      this.turning.delete(key);
    }
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
      // A conversation on a service keeps no memory: nothing to list (task 9.3).
      if (meta.engineId !== 'builtin') continue;
      // A journal that cannot be read leaves out only its own row (review of phase 8).
      const entries = await openJournal(this.deps.store.dir, meta.id, meta.branchId)
        .then((journal) => journal.entries())
        .catch(() => null);
      if (!entries?.some((entry) => entry.kind === 'user')) continue;
      const owner = this.ownerOf(meta);
      const manifest = await this.deps.kv.manifest(ownerKey(owner));
      const base = { id: meta.id, title: meta.title, projectId: meta.projectId ?? null, otherModel: false, rereadSeconds: null };
      // In the engine: kept there, or its turn holds the slot right now — as a turn ends, before the slot is let go
      // (gate of phase 13: the disk check, asked at that moment, missed it).
      const working = this.scheduler.busy.some((one) => one.kind === 'conversation' && one.conversationId === meta.id);
      if (working || this.scheduler.isResident(owner)) {
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
      if (what !== 'code') {
        ({ meta, journal } = (await this.keepCompaction(meta, journal, look.previousId)) ?? (await this.fork(meta, journal, look.previousId)));
      }
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
    // Back across a compaction (review of phase 7): before what it folded, the whole prefix kept is read again;
    // among the turns it kept, the branch keeps it — read from llama.cpp's checkpoint on a sliding window.
    if (look.after.some(isRefrozen)) {
      const cut = keptCut(entries, look.previousId);
      if (!cut) return reread(prefixTokens, 'rewind');
      if (engine.slidingWindow) return reread(estimateTokens(cut.head + cut.copies.map((entry) => entry.rendered ?? '').join('')), 'rewind');
      return 'kept';
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
      const journal = await openJournal(this.deps.store.dir, id, meta.branchId);
      const engineWindow = engine.live?.nCtx || (await engine.client.props()).nCtx || Number.POSITIVE_INFINITY;
      return this.compactNow(meta, journal, engine, { sink, window: this.windowOf(meta, engine, engineWindow), ...(signal ? { signal } : {}) });
    });
  }

  /**
   * A compaction, done: the summary asked of the conversation — or, `keepFrom`, of what comes before that entry,
   * kept as it was frozen —, then the rebase. Without a slot it takes the conversation's through the scheduler and
   * leaves nothing of it there; with one (`slot`: the turn under way holds it, audit 2026-11-21, D2), the turn goes
   * on in it from the rebase. When the whole conversation leaves no room for the question and its summary, the
   * summary is asked of what comes before its last turn, kept: the room a summary needs is never missing while the
   * last turn fits (`no-room` only when even that prefix leaves none).
   */
  private async compactNow(
    meta: ConversationMeta,
    journal: Journal,
    engine: EngineView,
    options: CompactOptions,
  ): Promise<CompactResult> {
    const { family, client } = engine;
    const { sink, signal, window } = options;
    const entries = journal.entries();
    // The turn under way folded on itself: its message and its last round kept, its earlier rounds summarised (D2).
    const fold = options.foldRounds ? planTurnFold(entries, estimateTokens) : null;
    const plan = fold ?? (options.keepFrom ? planCompactionKeeping(entries, options.keepFrom, estimateTokens) : planCompaction(entries, estimateTokens));
    // What the summary is asked of: the whole frozen text, or the prefix before what is kept as it was.
    const keptAt = fold ? fold.askedUntil : options.keepFrom ? entries.findIndex((entry) => entry.id === options.keepFrom) : entries.length;
    const asked = entries.slice(0, keptAt);
    // Asked in the middle of the model's turn, after the results of a round: that turn closed first, as an answer
    // that gave up its calls closes it — so that the question is the user's, in a turn of its own.
    const close = fold ? family.beginAssistant({ thinking: false, continuing: true }) + family.endAssistant('') : '';
    const frozen = frozenPrompt(asked) + close;
    const question = family.renderUser(fold ? SUMMARY_TURN_QUESTION : SUMMARY_QUESTION) + family.beginAssistant({ thinking: false });
    // What the engine holds, as it counted it, then the question: an estimate of the whole (three characters
    // a token) found no room in a conversation the engine held at 92 %, just when it had to be compacted.
    const used = (countedContext(asked) ?? estimateTokens(frozenPrompt(asked))) + estimateTokens(close + question);
    const nPredict = Math.min(SUMMARY_MAX_TOKENS, Math.floor(window - used - 64));
    if (nPredict < 256) {
      // The room a summary needs: asked of what comes before the last turn, which is kept (audit 2026-11-21, D2).
      const lastTurn = entries.findLast((entry) => entry.kind === 'user');
      if (!options.keepFrom && !fold && lastTurn && lastTurn.id !== plan.kept[0]?.id) {
        return this.compactNow(meta, journal, engine, { ...options, keepFrom: lastTurn.id });
      }
      throw new CompactionError('no-room', 'There is no room left in the context for a summary: nothing was compacted.');
    }

    const owner = this.ownerOf(meta);
    const key = ownerKey(owner);
    let summary = '';
    let cut = false;
    const summarise = async (slot: { id: number }): Promise<void> => {
      const demux = family.createDemux();
      const take = (pieces: DemuxEvent[]): void => {
        for (const piece of pieces) if (piece.type === 'text') summary += piece.delta;
      };
      for await (const event of client.complete({
        prompt: frozen + question,
        idSlot: slot.id,
        cachePrompt: true,
        nPredict,
        // The summary too samples as the family recommends, its reasoning off (audit 2026-11-21, D6).
        sampling: { ...family.sampling({ thinking: false }), stop: [...family.stop] },
        ...(signal ? { signal } : {}),
      })) {
        if (event.type === 'token') take(demux.push(event.text));
        else if (event.type === 'done') cut = event.stats.truncated || event.stats.predictedTokens >= nPredict;
      }
      take(demux.flush());
    };
    if (options.slot) {
      // The turn under way holds the slot: it reads on from the rebase in it.
      await summarise(options.slot);
    } else {
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
      try {
        await this.scheduler.run(owner, summarise, signal ? { signal } : {});
      } finally {
        this.turning.delete(key);
        // The slot holds the old prompt and the question: never saved as this conversation's memory.
        this.scheduler.evict(owner);
        this.lastRun.delete(key);
      }
    }
    if (cut) throw new CompactionError('cut', 'The summary was cut before its end: nothing was compacted.');
    summary = summary.trim();
    if (!summary) throw new CompactionError('empty', 'The summary came back empty: nothing was compacted.');

    // The system prompt frozen again, with the truth of the moment: every note folded in.
    const instructions = this.deps.instructions ? ((await this.deps.instructions(meta)) ?? '') : undefined;
    const { asked: decor, prompt } = await this.systemPrompt(meta, family, instructions, window);
    const stable = family.renderSystem(prompt.stable);
    // Folded on itself, the turn reads on from its message, its model's turn opened as its first answer opened it, then
    // its last answer and the results it waits on — as it was frozen.
    const kept = fold
      ? fold.user.rendered! +
        openingOf(fold.first, family) +
        rawOf(fold.round[0]!) +
        family.endAssistant(rawOf(fold.round[0]!)) +
        fold.round
          .slice(1)
          .map((entry) => entry.rendered ?? '')
          .join('')
      : plan.kept.map((entry) => entry.rendered ?? '').join('');
    const rendered = stable + family.renderSystemNote(prompt.project) + family.renderSystemNote(summaryNote(summary, fold !== null)) + kept;
    await journal.append({
      kind: 'rebase',
      summary,
      ...(plan.kept[0] ? { keptFrom: plan.kept[0].id } : {}),
      ...(fold ? { keptRound: fold.round[0]!.id } : {}),
      stable,
      replyLanguage: decor.replyLanguage,
      perimeter: [...decor.perimeter],
      tools: [...decor.tools],
      rendered,
    });
    if (instructions !== undefined) await this.deps.store.update(meta.id, { instructions });
    // The memory of the old prompt serves nothing any more.
    await this.deps.kv.forget(key);
    return {
      summary,
      compactedTurns: plan.compactedTurns,
      keptTurns: plan.keptTurns,
      // Two figures of one kind, the prompt's weight reckoned the same way before and after: the engine has counted
      // no prompt of the rebase yet (review of round 2, 10). The window says them as « about ».
      tokensBefore: estimateTokens(frozenPrompt(entries)),
      tokensAfter: estimateTokens(rendered),
    };
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
    answers: {
      outcomes: Record<string, Outcome>;
      results: readonly ToolResult[];
      pending?: { calls: PendingCall[]; ticket: string; subagents?: SubagentHold[] };
    },
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
      if (answers.pending) {
        const { calls, ticket, subagents } = answers.pending;
        await journal.append({ kind: 'pending', calls, ticket, ...(subagents?.length ? { subagents } : {}), rendered: '' });
      }
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
    // The server runs as many slots as it was launched with (task 8.3).
    const slots = engine.slots ?? this.deps.slots ?? 1;
    if (slots !== this.scheduler.size) this.scheduler.resize(slots);
  }

  /** How many slots the engine runs: more than one, and a step's sub-agents work together (task 8.3). */
  get slotCount(): number {
    return this.scheduler.size;
  }

  /**
   * A sub-agent that will never be resumed (its pause left for a new message, or a Stop while it was answered):
   * its state, in a slot or on disk, is worth nothing (review of phase 8).
   */
  async letGoSubagent(conversationId: string, agentId: string): Promise<void> {
    const left: SlotOwner = { kind: 'subagent', conversationId, agentId, name: '' };
    this.scheduler.evict(left);
    this.lastRun.delete(ownerKey(left));
    await this.deps.kv.forget(ownerKey(left)).catch(() => undefined);
  }

  /** The slots a new owner would take now without waiting: those free, less those others already wait for. */
  get freeSlots(): number {
    return Math.max(0, this.scheduler.idle - this.scheduler.waiting.length);
  }

  /** Would a new owner wait for a slot now — none free, or others before it? */
  private get crowded(): boolean {
    return this.scheduler.idle === 0 || this.scheduler.waiting.length > 0;
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
      // Its sub-agents' states too: one that waited for the person kept its own (task 8.1).
      for (const agentId of await this.subagentsOf(id)) {
        const owner: SlotOwner = { kind: 'subagent', conversationId: id, agentId, name: '' };
        this.scheduler.evict(owner);
        this.lastRun.delete(ownerKey(owner));
        await this.deps.kv.forget(ownerKey(owner));
      }
      await this.deps.store.remove(id);
    });
  }

  /** The sub-agents a conversation ran: their threads, kept apart. */
  private async subagentsOf(id: string): Promise<string[]> {
    try {
      return (await readdir(join(this.deps.store.dir, id, 'agents'), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  /** A sub-agent's thread (task 8.1): a journal of its own, beside its conversation's branches, never among them. */
  subagentJournal(conversationId: string, agentId: string): Promise<Journal> {
    return openJournal(join(this.deps.store.dir, conversationId, 'agents'), agentId);
  }

  /** The call a sub-agent waits on the person for, if it does. */
  async subagentPaused(conversationId: string, agentId: string): Promise<Extract<JournalEntry, { kind: 'pending' }> | null> {
    const last = (await this.subagentJournal(conversationId, agentId)).entries().at(-1);
    return last?.kind === 'pending' ? last : null;
  }

  /** The answers to a sub-agent's pause, in its thread: what it reads when it goes on, and a new pause if one waits again. */
  recordSubagentAnswers(
    conversationId: string,
    agentId: string,
    answers: { outcomes: Record<string, Outcome>; results: readonly ToolResult[]; pending?: { calls: PendingCall[]; ticket: string } },
  ): Promise<void> {
    return this.exclusive.run(`${conversationId}/${agentId}`, async () => {
      const engine = await this.deps.engine();
      if (!engine) throw new NoEngineError();
      const journal = await this.subagentJournal(conversationId, agentId);
      await journal.append({ kind: 'outcomes', outcomes: answers.outcomes, rendered: '' });
      if (answers.results.length > 0) {
        await journal.append({ kind: 'tool-results', results: [...answers.results], rendered: engine.family.renderToolResults(answers.results) });
      }
      if (answers.pending) await journal.append({ kind: 'pending', calls: answers.pending.calls, ticket: answers.pending.ticket, rendered: '' });
    });
  }

  /**
   * A sub-agent's turn (task 8.1): its rounds on the slot its conversation lends it (`lend`, the conversation's
   * turn under way), else on a slot it is given like any owner (its pause answered). Its prompt starts with its
   * conversation's first system turn — the seed serves it — then its note and its mission; what it leaves in the
   * slot once it is done is worth nothing, and its saved state, if it kept one to wait for the person, goes.
   * `answer`: the text of its last answer — what it returns to the conversation.
   */
  async subagentTurn(
    conversationId: string,
    agent: { agentId: string; name: string },
    input: SubagentTurnInput,
    sink: (event: TurnEvent) => void,
    options: { lend?: CallsSlot['lend']; signal?: AbortSignal } = {},
  ): Promise<TurnResult & { answer: string }> {
    const meta = await this.deps.store.get(conversationId);
    if (!meta) throw new Error(`There is no conversation ${conversationId}.`);
    const engine = await this.deps.engine();
    if (!engine) throw new NoEngineError();
    this.follow(engine);
    const { family, client } = engine;
    const { signal } = options;
    const journal = await this.subagentJournal(conversationId, agent.agentId);
    if (input.start && journal.entries().length === 0) {
      const parent = (await openJournal(this.deps.store.dir, conversationId, meta.branchId)).entries();
      await journal.append({ kind: 'system', rendered: stableOf(parent) });
      await journal.append({ kind: 'system', rendered: family.renderSystemNote(input.start.note) });
      await journal.append({ kind: 'user', text: input.start.mission, rendered: family.renderUser(input.start.mission) });
    }
    const entries = journal.entries();
    const frozen = frozenPrompt(entries);
    const engineWindow = engine.live?.nCtx || (await client.props()).nCtx || Number.POSITIVE_INFINITY;
    // A sub-agent reasons as its conversation does: off by default on a small context (audit I2).
    const thinking = input.thinking ?? defaultThinking(engineWindow);
    const opening = family.beginAssistant({ thinking, ...(input.resume ? { continuing: true } : {}) });
    const used = (countedContext(entries) ?? estimateTokens(frozen)) + estimateTokens(opening);
    if (used + REPLY_ROOM > engineWindow) throw new ContextFullError(this.contextFull(engine, used, engineWindow));

    const owner: SlotOwner = { kind: 'subagent', conversationId, agentId: agent.agentId, name: agent.name };
    const key = ownerKey(owner);
    const saved = engine.live ? await this.deps.kv.manifest(key) : null;
    const turning: Turning = {
      engine,
      stable: stableOf(entries),
      // Its pause answered: without its state, what it did before is read again.
      history: input.resume === true,
      sink,
      rereading: false,
      behind: saved !== null && savedBefore(entries, saved.savedAt),
    };
    this.turning.set(key, turning);
    this.lastRun.set(key, { engine, tokens: used });
    const work = (slot: { id: number }): Promise<TurnResult> =>
      this.rounds({
        journal,
        engine,
        owner,
        turning,
        prompt: frozen + opening,
        opening,
        thinking,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        tools: input.tools,
        sink,
        ...(signal ? { signal } : {}),
        answerOf: {},
        used,
        slot,
        thinkingCap: this.deps.subagentThinkingChars ?? SUBAGENT_THINKING_CHARS,
        tooLong: async () => {
          throw new ContextFullError(this.contextFull(engine, used, engineWindow));
        },
      });
    let result: TurnResult;
    try {
      if (options.lend) {
        result = await options.lend(owner, async (lent) => {
          let done: TurnResult;
          try {
            done = await work(lent);
          } catch (error) {
            // Failed (the server refused its prompt, the engine fell): what it leaves in the slot is worth nothing —
            // never saved, where it would cost the disk budget another conversation's memory (review of phase 8).
            lent.discard();
            throw error;
          }
          if (!done.suspended) lent.discard();
          return done;
        });
      } else {
        const waits = this.crowded;
        if (waits) sink({ type: 'step', name: 'slot-wait', phase: 'start' });
        result = await this.scheduler.run(
          owner,
          async (slot) => {
            if (waits) sink({ type: 'step', name: 'slot-wait', phase: 'end' });
            let done: TurnResult;
            try {
              done = await work(slot);
            } catch (error) {
              slot.discard();
              throw error;
            }
            // Done: what it leaves in the slot is worth nothing — said before the job ends, since the next
            // owner takes the slot the moment it does, and would save it (review of phase 8).
            if (!done.suspended) slot.discard();
            return done;
          },
          signal ? { signal } : {},
        );
      }
    } catch (error) {
      if (signal?.aborted && error instanceof DOMException && error.name === 'AbortError') {
        // Stopped while it waited for the slot.
        await journal.append({ kind: 'assistant', raw: '', stopped: 'user', rendered: opening + family.endAssistant('') });
        result = { usage: { inputTokens: 0, outputTokens: 0 }, stopped: 'user' };
      } else {
        // Failed on a slot of its own: neither kept there nor on disk.
        if (!options.lend) this.scheduler.evict(owner);
        this.lastRun.delete(key);
        await this.deps.kv.forget(key).catch(() => undefined);
        throw error;
      }
    } finally {
      this.turning.delete(key);
    }
    if (!result.suspended) {
      this.lastRun.delete(key);
      await this.deps.kv.forget(key).catch(() => undefined);
    }
    const last = journal.entries().findLast((entry): entry is Extract<JournalEntry, { kind: 'assistant' }> => entry.kind === 'assistant');
    return { ...result, answer: last ? textOf(family, last.raw) : '' };
  }

  /**
   * The system prompt as it is frozen now: what the conversation is told of its tools, folders and language, its
   * environment read at this moment, its instructions cut to the context it is frozen for (`window`, tokens: about
   * 12 % of it, audit 2026-11-21, I2). Only when a prompt is frozen — never between two rebases.
   */
  private async systemPrompt(meta: ConversationMeta, family: FamilyLayer, instructions: string | undefined, window: number) {
    const asked = this.deps.prompt(meta);
    const environment = this.deps.environment ? await this.deps.environment(meta).catch(() => undefined) : undefined;
    const said = instructions ? cutInstructions(instructions, instructionsBudget(window)) : '';
    const prompt = buildSystemPrompt({
      ...asked,
      family,
      ...(environment ? { environment } : {}),
      ...(said ? { projectInstructions: said } : {}),
    });
    return { asked, prompt };
  }

  /** The context a turn of this conversation has: its own cap, else the engine's (tokens; infinite when unknown). */
  private windowOf(meta: ConversationMeta, engine: Partial<Pick<EngineView, 'live'>>, engineWindow?: number): number {
    return Math.min(meta.contextCap ?? Number.POSITIVE_INFINITY, engineWindow ?? (engine.live?.nCtx || Number.POSITIVE_INFINITY));
  }

  /**
   * A compaction the context made necessary (audit 2026-11-21, D2): said on the turn's sink as it starts and ends,
   * with what the conversation held before and after. One that cannot be (too short, a summary cut) changes
   * nothing: false — the turn then says the context is full, as before.
   */
  private async autoCompact(
    meta: ConversationMeta,
    journal: Journal,
    engine: EngineView,
    options: CompactOptions,
  ): Promise<boolean> {
    options.sink({ type: 'compaction', phase: 'start' });
    try {
      const done = await this.compactNow(meta, journal, engine, options);
      options.sink({ type: 'compaction', phase: 'end', before: done.tokensBefore, after: done.tokensAfter });
      return true;
    } catch (error) {
      options.sink({ type: 'compaction', phase: 'end' });
      if (error instanceof CompactionError) return false;
      throw error;
    }
  }

  /**
   * The turn under way ran out of room between two rounds (audit 2026-11-21, D2): compacted in the slot it holds, and
   * it goes on. The turn is kept whole beside a summary of what came before it when that is worth folding and leaves
   * room; else — a fresh conversation, a rebase earlier in this turn, a turn that weighs too much — the turn is folded
   * on itself: its message and its last round kept, its earlier rounds in the summary (review of round 2, 5). False when
   * nothing could be compacted: the turn then ends as context-full.
   */
  private async compactTurn(meta: ConversationMeta, journal: Journal, engine: EngineView, options: CompactOptions, opening: string): Promise<boolean> {
    const entries = journal.entries();
    const current = entries.findLast((entry) => entry.kind === 'user');
    if (!current) return false;
    const fits = (): boolean => {
      const held = journal.entries();
      return (countedContext(held) ?? estimateTokens(frozenPrompt(held))) + estimateTokens(opening) + REPLY_ROOM <= options.window;
    };
    let whole = true;
    try {
      planCompactionKeeping(entries, current.id, estimateTokens);
      // The turn kept beside the head and its summary: room left for an answer?
      const turn = estimateTokens(entries.slice(entries.indexOf(current)).map((entry) => entry.rendered ?? '').join(''));
      const head = estimateTokens(stableOf(entries)) + Math.ceil(instructionsBudget(options.window) / 3);
      whole = head + SUMMARY_MAX_TOKENS + turn + REPLY_ROOM <= options.window;
    } catch (error) {
      if (!(error instanceof CompactionError)) throw error;
      whole = false;
    }
    if (whole && (await this.autoCompact(meta, journal, engine, { ...options, keepFrom: current.id })) && fits()) return true;
    if (!whole || !fits()) return this.autoCompact(meta, journal, engine, { ...options, foldRounds: true });
    return false;
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
    // A state frozen after a compaction or a change of model holds another prompt than a branch that starts
    // before it: never given to it — its reading is then said, never paid in silence (review of phase 7).
    const entries = journal.entries();
    const at = entries.findIndex((entry) => entry.id === afterEntryId);
    const crosses = entries.slice(at + 1).some(isRefrozen);
    const branch = await journal.fork(afterEntryId);
    const child: SlotOwner = { kind: 'conversation', conversationId: meta.id, branchId: branch.branchId };
    // A change of model starts from nothing: the state of the branch left is the old model's.
    if (options.memory !== false && !crosses) await this.deps.kv.copyState(ownerKey(parent), ownerKey(child));
    return { meta: await this.deps.store.update(meta.id, { branchId: branch.branchId }), journal: branch };
  }

  /**
   * A fork among the turns the last compaction kept (an answer asked again, a message changed, a going back):
   * the branch keeps the compaction — after its rebase, the rebase frozen again with its kept turns cut at the
   * fork point, those up to it copied after it. Null when the fork point is elsewhere (a plain fork then).
   */
  private async keepCompaction(
    meta: ConversationMeta,
    journal: Journal,
    afterEntryId: string,
  ): Promise<{ meta: ConversationMeta; journal: Journal } | null> {
    const cut = keptCut(journal.entries(), afterEntryId);
    if (!cut) return null;
    // After the rebase: the state given to the branch holds its head and the kept turns, a prefix of what follows.
    const moved = await this.fork(meta, journal, cut.rebase.id);
    const { id: _id, at: _at, keptFrom: _keptFrom, rendered: _rendered, ...rebase } = cut.rebase;
    await moved.journal.append({ ...rebase, rendered: cut.head });
    for (const entry of cut.copies) {
      const { id: _copyId, at: _copyAt, ...copy } = entry;
      // What the engine held when a kept answer was written — the whole conversation then — is not what this
      // branch holds: a copy keeps no count (countedContext falls back to the estimate until the next answer).
      if (copy.kind === 'assistant' && copy.usage?.contextTokens !== undefined) {
        const { contextTokens: _held, ...usage } = copy.usage;
        await moved.journal.append({ ...copy, usage } as NewJournalEntry);
        continue;
      }
      await moved.journal.append(copy as NewJournalEntry);
    }
    return moved;
  }

  /**
   * The notes a turn appends before its message, not yet appended: what changed since the model was last told —
   * its instructions (as it reads them: cut, so that an edit past the cut tells nothing), its tools, the window's
   * tools, its mode, its folders, its reply language. `instructions`: the whole text to record once told.
   */
  private async notesOf(
    meta: ConversationMeta,
    entries: readonly JournalEntry[],
    options: { family: FamilyLayer; window: number; instructions: string | undefined; tools?: TurnTools },
  ): Promise<{ notes: NewJournalEntry[]; instructions?: string }> {
    const { family, window, instructions } = options;
    const notes: NewJournalEntry[] = [];
    const note = (delta: Extract<NewJournalEntry, { kind: 'delta' }>['delta']): void => {
      notes.push({ kind: 'delta', delta, rendered: family.renderSystemNote(delta.text) });
    };
    let recorded: string | undefined;
    if (instructions !== undefined && !sameInstructions(meta.instructions ?? '', instructions)) {
      // The instructions changed since the model read them: a note, appended — the frozen text stays as it was.
      // Compared as the model reads them, cut to this context; the whole text recorded still (review of round 2, 9).
      const budget = instructionsBudget(window);
      const seen = cutInstructions(meta.instructions ?? '', budget);
      const now = cutInstructions(instructions, budget);
      const delta = sameInstructions(seen, now) ? null : renderInstructionsDelta(seen, now);
      if (delta) note(delta);
      recorded = instructions;
    }
    const asked = this.deps.prompt(meta);
    // The core's tools changed (a plugin came or went, or was turned off for the project).
    const tools = [...asked.tools];
    const toldTools = lastToldTools(entries);
    const inventory = toldTools === undefined ? null : renderInventoryDelta(toldTools, tools);
    if (inventory) note({ ...inventory, tools });
    if (options.tools) {
      // The tools the window runs (ask_user) are not in the frozen prompt: told by a note when they change.
      const windowTools = options.tools.defs.filter((tool) => tool.where === 'window');
      const delta = renderInventoryDelta(lastToldWindowTools(entries), windowTools);
      if (delta) note({ ...delta, windowTools });
    }
    // A discussion has no mode to be told (task 9.7): nothing to change, no plan to present.
    if (meta.kind !== 'discussion') {
      // The mode the calls are decided in, told when it is not the one the model last read (Répétition until told).
      const running = this.deps.mode ? await this.deps.mode(meta) : meta.mode;
      const told = lastToldMode(entries);
      // Leaving Lecture launches a plan only when one was presented since the model was told Lecture.
      if (running !== told) note(renderModeDelta(running, told === 'lecture' && running !== 'lecture' && planSinceLecture(entries)));
    }
    // The project's folders changed (one added, one removed).
    const roots = [...asked.perimeter];
    const toldRoots = lastToldPerimeter(entries);
    const perimeter = toldRoots === undefined ? null : renderPerimeterDelta(toldRoots, roots, meta.worktree ? meta.branch : undefined);
    if (perimeter) note({ ...perimeter, roots });
    // The language of the interface changed: the replies follow it.
    const language = asked.replyLanguage;
    const toldLanguage = lastToldReplyLanguage(entries);
    const reply = toldLanguage === undefined || !language ? null : renderReplyLanguageDelta(toldLanguage, language);
    if (reply) note({ ...reply, language });
    return { notes, ...(recorded !== undefined ? { instructions: recorded } : {}) };
  }

  /**
   * What a change of model would freeze (task 7.4): the system prompt frozen again for the engine's family,
   * with the truth of the moment, then the conversation rendered again by that family.
   */
  private async refreezeFor(
    meta: ConversationMeta,
    entries: readonly JournalEntry[],
    engine: ModelTarget & Partial<Pick<EngineView, 'live'>>,
    instructions: string | undefined,
  ) {
    const { family } = engine;
    // The context the target runs with: its own, else the one its load takes (review of round 2, 3).
    const window = this.windowOf(meta, engine, engine.nCtx || engine.live?.nCtx || undefined);
    const { asked, prompt } = await this.systemPrompt(meta, family, instructions, window);
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
  async rereadOn(id: string, target: ModelTarget): Promise<number> {
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
  copy(id: string, target: ModelTarget): Promise<ConversationMeta> {
    return this.exclusive.run(id, async () => {
      const meta = await this.deps.store.get(id);
      if (!meta) throw new Error(`There is no conversation ${id}.`);
      const created = await this.deps.store.create({
        kind: meta.kind,
        // The copy goes to the built-in engine's model, whatever the original runs on — a service included.
        engineId: 'builtin',
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
    engineWindow: number,
  ): Promise<{ meta: ConversationMeta; journal: Journal }> {
    const entries = journal.entries();
    const last = entries.at(-1);
    const moved = last ? await this.fork(meta, journal, last.id, { memory: false }) : { meta, journal };
    const target = Number.isFinite(engineWindow) ? { ...engine, nCtx: engineWindow } : engine;
    const { asked, stable, rendered } = await this.refreezeFor(moved.meta, entries, target, instructions);
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
    if (input.forkAfter) {
      ({ meta, journal } = (await this.keepCompaction(meta, journal, input.forkAfter)) ?? (await this.fork(meta, journal, input.forkAfter)));
    }
    // Each answer names the window's message it fills: the sibling the person picks is found by it.
    const answerOf = input.messageId ? { messageId: input.messageId } : {};
    // The context of this turn: what the instructions take of a frozen prompt, whether it reasons by default, what fits.
    const engineWindow = engine.live?.nCtx || (await client.props()).nCtx || Number.POSITIVE_INFINITY;
    const window = this.windowOf(meta, engine, engineWindow);
    // On a small context the model answers without reasoning unless the conversation says otherwise (audit I2).
    const thinking = input.thinking ?? defaultThinking(window);

    const instructions = this.deps.instructions ? ((await this.deps.instructions(meta)) ?? '') : undefined;
    // A branch frozen for another model goes on in a new branch, the conversation rendered again (task 7.4).
    if (onAnotherModel(branchModel(journal.entries()), engine)) {
      ({ meta, journal } = await this.changeModel(meta, journal, engine, instructions, engineWindow));
    }
    // A branch frozen again (a change of model) has its system turn in that entry: one started on a service has
    // no other, and never reads a second one after the person's message (review of phase 9).
    if (!journal.entries().some((entry) => entry.kind === 'system' || (isRefrozen(entry) && entry.rendered !== undefined))) {
      const { asked, prompt } = await this.systemPrompt(meta, family, instructions, window);
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
    // What the branch froze before this turn: a state saved after it is not behind for the notes this turn
    // appends next — they are read with the message, as it is.
    const known = journal.entries().length;
    // A model turn left open by calls nobody answered (a limit, a pause given up): closed before any note. The
    // sub-agents that waited in that pause are let go: never resumed, their state is worth nothing.
    if (!input.resume) {
      for (const agentId of await closeOpenTurn(journal, family)) await this.letGoSubagent(id, agentId);
    }
    if (!input.resume) {
      // A going back the model has not heard of is told now; once a turn begins it cannot be undone.
      await tellRewind(journal, family);
      if (meta.rewound) meta = await this.deps.store.update(id, { rewound: undefined });
    }
    if (!input.resume) {
      // The notes this turn appends, measured before anything is decided: the message and its notes would not fit
      // beside what the conversation holds — it is compacted first, said in the thread, never a turn refused in the
      // middle of a task, never a silent re-read (audit 2026-11-21, D2). The rebase froze what changed: the notes are
      // asked again of it, the conversation as the compaction left it (review of round 2: 1, 2).
      let pending = await this.notesOf(meta, journal.entries(), { family, window, instructions, ...(input.tools ? { tools: input.tools } : {}) });
      const held = journal.entries();
      const adds =
        pending.notes.map((note) => note.rendered ?? '').join('') +
        (input.text === undefined ? '' : family.renderUser(input.text)) +
        family.beginAssistant({ thinking });
      const needed = (countedContext(held) ?? estimateTokens(frozenPrompt(held))) + estimateTokens(adds);
      if (needed + REPLY_ROOM > window && held.some((entry) => entry.kind === 'user')) {
        if (await this.autoCompact(meta, journal, engine, { sink, window, ...(signal ? { signal } : {}) })) {
          meta = (await this.deps.store.get(id)) ?? meta;
          pending = await this.notesOf(meta, journal.entries(), { family, window, instructions, ...(input.tools ? { tools: input.tools } : {}) });
        }
      }
      for (const note of pending.notes) await journal.append(note);
      if (pending.instructions !== undefined) meta = await this.deps.store.update(id, { instructions: pending.instructions });
    }
    const entries = journal.entries();
    const stable = stableOf(entries);
    const frozen = frozenPrompt(entries);
    // Answering the last message again appends no message.
    const userRendered = input.text === undefined ? '' : family.renderUser(input.text);
    const opening = family.beginAssistant({ thinking, ...(input.resume ? { continuing: true } : {}) });

    // Never a context shift: what does not fit is refused before anything is sent.
    // What the engine holds, as it counted it, and what this turn adds: an estimate of the whole (three
    // characters a token) refused, in prose, messages the engine had room for. The server refuses what does
    // not fit after all (below).
    const used = (countedContext(entries) ?? estimateTokens(frozen)) + estimateTokens(userRendered + opening);
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
      behind: saved !== null && savedBefore(entries.slice(0, known), saved.savedAt),
    };
    this.turning.set(key, turning);
    this.lastRun.set(key, { engine, tokens: used });

    const waits = this.crowded;
    if (waits) sink({ type: 'step', name: 'slot-wait', phase: 'start' });
    try {
      return await this.scheduler.run(
        owner,
        async (slot) => {
          if (waits) sink({ type: 'step', name: 'slot-wait', phase: 'end' });
          return this.rounds({
            journal,
            engine,
            owner,
            turning,
            prompt: frozen + userRendered + opening,
            opening,
            thinking,
            ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
            ...(input.tools ? { tools: input.tools } : {}),
            sink,
            ...(signal ? { signal } : {}),
            answerOf,
            used,
            slot,
            window,
            // Its context run out between two rounds: compacted on its own, the turn under way kept as it was (D2).
            compactMidTurn: (held, opening) => this.compactTurn(meta, journal, engine, { sink, window, slot: held, ...(signal ? { signal } : {}) }, opening),
            tooLong: async (round, prompt) => {
              // The server read nothing of it: the slot holds what it held. The person's message is taken
              // back when it is what did not fit; after tool rounds, what they gave stays.
              slot.unchanged();
              if (user && round === 0) await journal.append({ kind: 'withdrawn', entryId: user.id });
              throw new ContextFullError(this.contextFull(engine, round === 0 ? used : estimateTokens(prompt), window));
            },
          });
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

  /**
   * The rounds of a turn in the slot it holds: one completion a round; a round that ends on calls is answered,
   * and the next reads the results. The conversation's own turn may lend its slot to its sub-agents while its
   * calls run (task 8.1): it comes home before its next round.
   */
  private async rounds(run: {
    journal: Journal;
    engine: EngineView;
    owner: SlotOwner;
    turning: Turning;
    /** The first prompt: the frozen text, the message, the answer's opening. */
    prompt: string;
    opening: string;
    thinking: boolean;
    /** The conversation's own temperature (task 12.4). */
    temperature?: number;
    /** Reasoning past this many characters in one answer cuts it (a sub-agent's: nobody watches it). */
    thinkingCap?: number;
    tools?: TurnTools;
    sink: (event: TurnEvent) => void;
    signal?: AbortSignal;
    /** The window's message each answer fills. */
    answerOf: { messageId?: string };
    /** What the turn reckoned it holds: what a save weighs until the engine has counted it. */
    used: number;
    /** The slot: the conversation's own (it may lend it), or the one a sub-agent was lent or given. */
    slot: { id: number } & Partial<Pick<SlotHandle, 'lend' | 'home'>>;
    /** The server refused a prompt as longer than its context, in this round. */
    tooLong(round: number, prompt: string): Promise<never>;
    /** The turn's context (tokens): between two rounds, what would not fit is compacted (`compactMidTurn`). */
    window?: number;
    /** Compacts the conversation, the turn under way kept, in the slot it holds; false when it could not be. */
    compactMidTurn?(slot: { id: number }, opening: string): Promise<boolean>;
  }): Promise<TurnResult> {
    const { journal, engine, owner, turning, tools, sink, signal, answerOf, slot } = run;
    const { family, client } = engine;
    const key = ownerKey(owner);
    const grammar = tools ? family.toolGrammar(tools.defs) : null;
    let prompt = run.prompt;
    let roundOpening = run.opening;
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const finishReread = (): void => {
      if (!turning.rereading) return;
      turning.rereading = false;
      sink({ type: 'step', name: 'reread', phase: 'end' });
    };
    for (let round = 0; ; round += 1) {
      if (round > 0) sink({ type: 'round' });
      const demux = family.createDemux();
      let raw = '';
      let truncated = false;
      let finished = false;
      const calls: ModelCall[] = [];
      // A reasoning past its cap: this answer is cut, the turn's own signal untouched.
      const overthinking = new AbortController();
      let thought = 0;
      const take = (piece: DemuxEvent): void => {
        if (overthinking.signal.aborted) return;
        if (piece.type === 'tool-call') calls.push({ id: `call-${randomUUID()}`, name: piece.name, input: piece.input });
        if (piece.type === 'thinking' && run.thinkingCap !== undefined) {
          thought += piece.delta.length;
          if (thought > run.thinkingCap) overthinking.abort();
        }
        sink(piece);
      };
      const completionSignal = signal ? AbortSignal.any([signal, overthinking.signal]) : overthinking.signal;
      try {
        for await (const event of client.complete({
          prompt,
          idSlot: slot.id,
          cachePrompt: true,
          returnProgress: true,
          // The family's recommended sampling, the conversation's temperature over it (audit 2026-11-21, D6).
          sampling: {
            ...family.sampling({ thinking: run.thinking }),
            stop: [...family.stop],
            ...(run.temperature !== undefined ? { temperature: run.temperature } : {}),
          },
          ...(grammar ?? {}),
          signal: completionSignal,
        })) {
          if (overthinking.signal.aborted) break;
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
              ...(stats.contextTokens ? { contextTokens: stats.contextTokens } : {}),
            };
            this.measure(engine, stats.promptUncachedTokens, stats.promptMs);
            this.lastRun.set(key, { engine, tokens: stats.contextTokens || run.used });
            truncated = stats.truncated === true;
          }
        }
        if (!overthinking.signal.aborted) for (const piece of demux.flush()) take(piece);
        finishReread();
        if (overthinking.signal.aborted && !signal?.aborted) throw overthinking.signal.reason;
        // The stream ended without its final event: the person stopped it (it may end quietly then),
        // or the engine went away.
        if (!finished) {
          throw signal?.aborted
            ? new DOMException('The answer was stopped.', 'AbortError')
            : new Error('The engine ended its answer before finishing it.');
        }
      } catch (error) {
        finishReread();
        if (overthinking.signal.aborted && !signal?.aborted) {
          // Its own journal keeps what it wrote; the turn ends here, said by whoever runs it.
          await journal.append({ kind: 'assistant', raw, usage, ...answerOf, rendered: roundOpening + raw + family.endAssistant(raw) });
          return { usage, overthought: run.thinkingCap! };
        }
        if (signal?.aborted) {
          await journal.append({ kind: 'assistant', raw, stopped: 'user', ...answerOf, rendered: roundOpening + raw + family.endAssistant(raw) });
          return { usage, stopped: 'user' as const };
        }
        if (refusedAsTooLong(error)) return run.tooLong(round, prompt);
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
      if (!tools || calls.length === 0 || truncated) {
        return truncated ? { usage, truncated: true as const } : { usage };
      }

      const answer = await tools.onCalls(calls, slot.lend ? { lend: slot.lend } : undefined);
      if ('stop' in answer) return { usage, limited: true as const };
      if ('suspend' in answer) {
        // What ran before the pause is kept; the calls that wait enter the prompt once answered (4.5).
        const ran = answer.suspend.results ?? [];
        if (ran.length > 0) await journal.append({ kind: 'tool-results', results: ran, rendered: family.renderToolResults(ran) });
        await journal.append({
          kind: 'pending',
          calls: answer.suspend.pending,
          ticket: answer.suspend.ticket,
          ...(answer.suspend.subagents?.length ? { subagents: answer.suspend.subagents } : {}),
          rendered: '',
        });
        return { usage, suspended: answer.suspend };
      }
      // The results, disarmed by the family as it renders them, then the model's answer goes on.
      await journal.append({ kind: 'tool-results', results: answer.results, rendered: family.renderToolResults(answer.results) });
      // Lent to its sub-agents while the calls ran: the conversation comes home before it reads on.
      await slot.home?.();
      roundOpening = family.beginAssistant({ thinking: run.thinking, continuing: true });
      if (run.window !== undefined && run.compactMidTurn) {
        // The results would leave no room for the next answer: compacted now, while the turn goes on (D2).
        const held = journal.entries();
        const needed = (countedContext(held) ?? estimateTokens(frozenPrompt(held))) + estimateTokens(roundOpening);
        if (needed + REPLY_ROOM > run.window) await run.compactMidTurn(slot, roundOpening);
      }
      prompt = frozenPrompt(journal.entries()) + roundOpening;
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
      keep: incoming?.kind === 'conversation' || incoming?.kind === 'subagent' ? [ownerKey(incoming)] : [],
    });
    // Saved in the middle of its turn (lent to a sub-agent): its state is as new as its conversation now.
    const turning = this.turning.get(ownerKey(owner));
    if (turning) turning.behind = false;
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
/** What an answer says, its calls and its reasoning left out: a sub-agent's result. */
function textOf(family: FamilyLayer, raw: string): string {
  const demux = family.createDemux();
  const pieces = [...demux.push(raw), ...demux.flush()];
  return pieces
    .map((piece) => (piece.type === 'text' ? piece.delta : ''))
    .join('')
    .trim();
}

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
/** What the model reads of a sub-agent left waiting for the person, who moved on. */
export const SUBAGENT_LEFT = 'Stopped: the sub-agent waited for an answer the user never gave; it returns nothing.';

/**
 * A model turn that ended on calls nobody answered — the round limit reached, a pause the person
 * left — is closed before the next message: each call answered as not run, then the turn closed,
 * so the prompt keeps the template's shape (a Gemma turn that ended on a call is still open).
 * A pause of sub-agents answers the conversation's own calls — its `run_subagent` ones included —,
 * never the sub-agents' calls, which the model never made (review of phase 8). Returns the
 * sub-agents let go.
 */
async function closeOpenTurn(journal: Journal, family: FamilyLayer): Promise<string[]> {
  // The last thing said: a change of model, a going back or a rebase after it leave its turn open as it was
  // (review of phase 7: a call that waited stayed unanswered after a change of model).
  const last = journal.entries().findLast((entry) => SPOKEN.has(entry.kind));
  let open: { toolCallId: string; name: string; content?: string }[];
  let left: string[] = [];
  if (last?.kind === 'pending') {
    const holds = last.subagents ?? [];
    // One that ended behind another (in parallel) gives its result; one that still waited is let go.
    left = holds.filter((hold) => !hold.result).map((hold) => hold.agentId);
    open = [
      ...holds.map((hold) => ({ toolCallId: hold.toolCallId, name: hold.name, content: hold.result?.content ?? SUBAGENT_LEFT })),
      ...last.calls.filter((call) => !call.agentId).map((call) => ({ toolCallId: call.toolCallId, name: call.name })),
    ];
  } else if (last?.kind === 'tool-results') {
    // The results are there, the continuation never came (it did not fit, the engine failed): only the close.
    open = [];
  } else if (last?.kind === 'assistant' && family.endAssistant(last.raw) === '') {
    const demux = family.createDemux();
    open = [...demux.push(last.raw), ...demux.flush()]
      .filter((piece): piece is Extract<DemuxEvent, { type: 'tool-call' }> => piece.type === 'tool-call')
      .map((piece) => ({ toolCallId: `call-${randomUUID()}`, name: piece.name }));
  } else {
    return [];
  }
  const results: ToolResult[] = open.map((call) => ({ toolCallId: call.toolCallId, name: call.name, content: call.content ?? NOT_RUN_UNANSWERED, failed: true }));
  if (results.length > 0) await journal.append({ kind: 'tool-results', results, rendered: family.renderToolResults(results) });
  await journal.append({
    kind: 'assistant',
    raw: '',
    stopped: 'user',
    rendered: family.beginAssistant({ thinking: false, continuing: true }) + family.endAssistant(''),
  });
  return left;
}

/** What a turn says: what can leave a model's turn open. */
const SPOKEN = new Set<JournalEntry['kind']>(['user', 'assistant', 'tool-results', 'pending']);

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

