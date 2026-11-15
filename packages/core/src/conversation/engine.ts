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

import type { LlamaCppHttpClient } from '../backend/llamacpp/http-client.js';
import { LlamaCppHttpError } from '../backend/llamacpp/http-client.js';
import { announceOpen, DEFAULT_PREFILL_TOKENS_PER_SECOND, type Announcement } from '../costs/announce.js';
import { createSlotScheduler, type SlotOwner, type SlotScheduler } from '../engine/slot-scheduler.js';
import type { MeasureStore } from '../engine/measures.js';
import type { DemuxEvent, FamilyLayer } from '../families/types.js';
import { KeyedQueue } from '../fs/json-file.js';
import { frozenPrompt, openJournal } from '../journal/journal.js';
import type { Journal, JournalEntry, Usage } from '../journal/types.js';
import { canRestore, type KvStore, type LiveConfig } from '../kv/kv-store.js';
import { buildSystemPrompt, type SystemPromptOptions } from '../prompt/system-prompt.js';
import type { ConversationMeta, ConversationStore } from './store.js';

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
}

export type TurnEvent =
  | DemuxEvent
  /** What the turn waits for, said while it waits: the slot, a restore, a seed, a re-read. */
  | { type: 'step'; name: 'slot-wait' | 'restore' | 'seed' | 'reread'; phase: 'start' | 'end' }
  /** The prompt being read, as the server counts it. */
  | { type: 'progress'; done: number; total: number };

export interface TurnInput {
  /** The person's message; absent: the last one is answered again (with `forkAfter`). */
  text?: string;
  messageId?: string;
  thinking?: boolean;
  /**
   * A branch first, after this entry: the last answer asked again (`retry`),
   * or a message changed (`edit`). What followed stays in the branch it was in.
   */
  forkAfter?: string;
}

export interface TurnResult {
  usage: Usage;
  stopped?: 'user';
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
    const manifest = await this.deps.kv.manifest(key);
    let refusal: Parameters<typeof announceOpen>[0]['refusal'] = null;
    if (!manifest) refusal = 'missing';
    else {
      const verdict = canRestore(manifest, engine.live);
      if (!verdict.ok) refusal = verdict.reason;
    }
    const prefill = this.deps.measures?.get(engine.modelPath)?.prefillTokensPerSecond;
    return announceOpen({
      resident: this.scheduler.isResident(owner),
      promptTokens: estimateTokens(frozenPrompt(entries)),
      saved: refusal === null ? manifest : null,
      refusal,
      behind: manifest !== null && savedBefore(entries, manifest.savedAt),
      diedMidAnswer: last?.stopped === 'engine' && (!manifest || manifest.savedAt < last.at),
      evicted: manifest ? null : await this.deps.kv.evicted(key),
      measures: prefill === undefined ? {} : { prefillTokensPerSecond: prefill },
    });
  }

  turn(id: string, input: TurnInput, sink: (event: TurnEvent) => void, signal?: AbortSignal): Promise<TurnResult> {
    return this.exclusive.run(id, () => this.runTurn(id, input, sink, signal));
  }

  /** Saves the conversations whose state changed (the app closes). */
  async flush(): Promise<void> {
    const engine = await this.deps.engine();
    if (engine) this.follow(engine);
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
  private async fork(meta: ConversationMeta, journal: Journal, afterEntryId: string): Promise<{ meta: ConversationMeta; journal: Journal }> {
    const parent = this.ownerOf(meta);
    await this.scheduler.flush();
    const branch = await journal.fork(afterEntryId);
    const child: SlotOwner = { kind: 'conversation', conversationId: meta.id, branchId: branch.branchId };
    await this.deps.kv.copyState(ownerKey(parent), ownerKey(child));
    return { meta: await this.deps.store.update(meta.id, { branchId: branch.branchId }), journal: branch };
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

    if (!journal.entries().some((entry) => entry.kind === 'system')) {
      const prompt = buildSystemPrompt({ ...this.deps.prompt(meta), family });
      await journal.append({ kind: 'system', rendered: family.renderSystem(prompt.stable) });
      await journal.append({ kind: 'system', rendered: family.renderSystemNote(prompt.project) });
    }
    const entries = journal.entries();
    const stable = entries.find((entry) => entry.kind === 'system')?.rendered ?? '';
    const frozen = frozenPrompt(entries);
    // Answering the last message again appends no message.
    const userRendered = input.text === undefined ? '' : family.renderUser(input.text);
    const opening = family.beginAssistant({ thinking: input.thinking ?? true });

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
          const prompt = frozen + userRendered + opening;
          const demux = family.createDemux();
          let raw = '';
          let usage: Usage = { inputTokens: 0, outputTokens: 0 };
          let finished = false;
          const finishReread = (): void => {
            if (!turning.rereading) return;
            turning.rereading = false;
            sink({ type: 'step', name: 'reread', phase: 'end' });
          };
          try {
            for await (const event of client.complete({
              prompt,
              idSlot: slot.id,
              cachePrompt: true,
              returnProgress: true,
              sampling: { stop: [...family.stop] },
              ...(signal ? { signal } : {}),
            })) {
              if (event.type === 'token') {
                finishReread();
                raw += event.text;
                for (const piece of demux.push(event.text)) sink(piece);
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
              }
            }
            for (const piece of demux.flush()) sink(piece);
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
              await journal.append({ kind: 'assistant', raw, stopped: 'user', rendered: opening + raw + family.endAssistant(raw) });
              return { usage, stopped: 'user' as const };
            }
            if (refusedAsTooLong(error)) {
              // The server read nothing of it: the slot holds what it held, and the message is taken back.
              slot.unchanged();
              if (user) await journal.append({ kind: 'withdrawn', entryId: user.id });
              throw new ContextFullError(this.contextFull(engine, used, window));
            }
            await journal.append({ kind: 'assistant', raw, stopped: 'engine', rendered: opening + raw + family.endAssistant(raw) });
            // What the slot held is gone with the engine: nothing of it is saved.
            this.scheduler.evict(owner);
            throw new EngineFailedError(error);
          }
          await journal.append({ kind: 'assistant', raw, usage, rendered: opening + raw + family.endAssistant(raw) });
          return { usage };
        },
        signal ? { signal } : {},
      );
    } catch (error) {
      // Stopped while it waited for the slot: the message stays, with an empty answer stopped by the person.
      if (signal?.aborted && error instanceof DOMException && error.name === 'AbortError') {
        await journal.append({ kind: 'assistant', raw: '', stopped: 'user', rendered: opening + family.endAssistant('') });
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
  private async save(owner: SlotOwner, slotId: number, incoming?: SlotOwner): Promise<void> {
    const last = this.lastRun.get(ownerKey(owner));
    const live = last?.engine.live;
    if (!last || !live) return;
    // The slot of a server that went away holds nothing of this conversation.
    if ((await this.deps.engine())?.generation !== last.engine.generation) return;
    await this.deps.kv.saveState(last.engine.client, slotId, ownerKey(owner), live, {
      expectedBytes: last.tokens * (last.engine.kvBytesPerToken ?? 0),
      keep: incoming?.kind === 'conversation' ? [ownerKey(incoming)] : [],
    });
  }
}
