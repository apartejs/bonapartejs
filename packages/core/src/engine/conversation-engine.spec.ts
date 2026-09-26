/**
 * ConversationEngine — the object that OWNS the open conversation, in core:
 * which conversation is active, its session on the one slot, the events of
 * the turn in flight, the state to save before anything else takes the
 * slot. The Electron harness becomes IPC glue around it (D-24, D-30).
 *
 * The criterion the whole thing is built for: a generation survives
 * navigation. Browsing another conversation while a reply streams must
 * neither cut the stream nor lose it — it completes, it is persisted, and
 * a screen that comes back can catch up on what arrived meanwhile.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProcessHandle, SpawnFn } from '../backend/llamacpp/llamacpp-backend.js';
import { ConversationStore } from '../conversation/store.js';
import { KvStore } from '../kv/kv-store.js';
import { PermissionEngine } from '../permissions/engine.js';
import {
  startFakeLlamaServer,
  type FakeLlamaServer,
  type FakeLlamaServerOptions,
  type FakeSlotSnapshot,
} from '../testing/fake-llama-server.js';
import { ToolRegistry } from '../tools/registry.js';
import { builtinTools } from '../tools/builtin/index.js';
import { CheckpointStore } from '../checkpoints/store.js';
import {
  ConversationEngine,
  readableEvents,
  type ConversationEngineOptions,
  type TaggedEvent,
} from './conversation-engine.js';
import { EngineSupervisor } from './supervisor.js';
import { MeasureStore } from './measures.js';

let servers: FakeLlamaServer[] = [];
let dirs: string[] = [];
let engines: ConversationEngine[] = [];

afterEach(async () => {
  await Promise.all(engines.map((e) => e.close()));
  engines = [];
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

const MODEL = 'D:\\models\\qwen3.gguf';

let spawns = 0;
const fakeSpawn: SpawnFn = () => {
  spawns++;
  const handle: ProcessHandle = { pid: 1, onExit: () => undefined, kill: () => undefined };
  return handle;
};

interface Rig {
  engine: ConversationEngine;
  store: ConversationStore;
  kv: KvStore;
  server: FakeLlamaServer;
  events: TaggedEvent[];
  disk: Map<string, FakeSlotSnapshot>;
  /** How many completions the server has served. */
  turns: () => number;
}

async function makeRig(
  options: {
    replies?: string[];
    msPerToken?: number;
    /** Real delay between streamed chunks — for acting mid-stream. */
    paceMs?: number;
    /** Context size the engine is configured with (default 4096). */
    nCtx?: number;
    /** Context size the FAKE SERVER enforces: a longer prompt is refused with a 400. */
    serverNCtx?: number;
    /** The fake server flags the final event as truncated (the context ceiling). */
    truncate?: boolean;
    /** Answers by prompt instead of by turn (replaces `replies`). */
    responder?: (prompt: string) => string;
    /** More options for the fake server. */
    server?: Partial<FakeLlamaServerOptions>;
    modelExists?: boolean;
    /** What the machine measured — shared by the supervisor and the engine, as in the app. */
    measures?: MeasureStore;
    engine?: Partial<ConversationEngineOptions>;
  } = {},
): Promise<Rig> {
  let turn = 0;
  const replies = options.replies ?? ['ok'];
  const disk = new Map<string, FakeSlotSnapshot>();
  const dir = await mkdtemp(join(tmpdir(), 'bp-conv-engine-'));
  dirs.push(dir);
  const server = await startFakeLlamaServer({
    slotDir: join(dir, 'kv-slots'),
    msPerToken: options.msPerToken ?? 2,
    ...(options.paceMs !== undefined ? { paceMs: options.paceMs } : {}),
    ...(options.serverNCtx !== undefined ? { nCtx: options.serverNCtx } : {}),
    ...(options.truncate ? { truncate: true } : {}),
    responder: options.responder
      ? (prompt: string) => {
          turn++;
          return options.responder!(prompt);
        }
      : () => replies[Math.min(turn++, replies.length - 1)] ?? '',
    files: disk,
    ...options.server,
  });
  servers.push(server);

  const supervisor = new EngineSupervisor({
    slotsDir: join(dir, 'kv-slots'),
    pidFile: join(dir, 'managed-server.pid'),
    spawnFn: fakeSpawn,
    port: server.port,
    baseUrl: server.url,
    fingerprint: async () => 'fp-1',
    buildTag: async () => 'b1',
    commandPrefix: () => [],
    healthIntervalMs: 5,
    healthTimeoutMs: 300,
    logger: () => undefined,
    ...(options.measures ? { measures: options.measures } : {}),
  });
  await supervisor.configure({ mode: 'managed', binPath: 'llama', nCtx: options.nCtx ?? 4096 });

  const store = new ConversationStore(join(dir, 'conversations'));
  const kv = new KvStore(join(dir, 'kv-slots'));
  const engine = new ConversationEngine({
    store,
    kv,
    registry: new ToolRegistry(),
    permissions: new PermissionEngine('repetition'),
    supervisor,
    modelExists: () => options.modelExists ?? true,
    context: async () => ({ replyLanguage: 'English' }),
    ...(options.measures ? { measures: options.measures } : {}),
    ...options.engine,
  });
  engines.push(engine);
  const events: TaggedEvent[] = [];
  engine.onEvent((event) => events.push(event));
  return { engine, store, kv, server, events, disk, turns: () => turn };
}

const assistantText = (events: TaggedEvent[], id: string): string =>
  events
    .filter((e) => e.conversationId === id && e.event.type === 'token')
    .map((e) => (e.event.type === 'token' ? e.event.text : ''))
    .join('');

const turnEnded = (events: TaggedEvent[], id: string): boolean =>
  events.some((e) => e.conversationId === id && e.event.type === 'turn_end');

async function until(predicate: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('ConversationEngine — opening', () => {
  it('opens a fresh conversation on the model it is given, and reports no restore', async () => {
    const { engine, store } = await makeRig();

    const reply = await engine.open('conv-a', MODEL);

    expect('needsModel' in reply).toBe(false);
    if ('needsModel' in reply) return;
    expect(reply.conversationId).toBe('conv-a');
    expect(reply.modelPath).toBe(MODEL);
    expect(reply.nCtx).toBe(4096);
    expect(reply.events).toEqual([]);
    expect(reply.restore.restored).toBe(false);
    expect((await store.meta('conv-a')).modelPath).toBe(MODEL);
    expect(engine.active).toBe('conv-a');
  });

  it('asks for a model when none is pinned and none is default', async () => {
    const { engine } = await makeRig();

    const reply = await engine.open('conv-a');

    expect(reply).toEqual({ needsModel: true, conversationId: 'conv-a' });
  });

  it('names the pinned model whose file vanished, before any launch', async () => {
    const { engine, store } = await makeRig({ modelExists: false });
    await store.create('conv-a', { modelPath: MODEL });

    const reply = await engine.open('conv-a');

    expect(reply).toEqual({ needsModel: true, conversationId: 'conv-a', missingModel: MODEL });
    expect(engine.active).toBeNull();
  });

  it('history is read-only: it wakes nothing and flags a vanished model', async () => {
    const { engine, store } = await makeRig({ modelExists: false });
    await store.create('conv-a', { modelPath: MODEL });
    await store.appendEvent('conv-a', { type: 'user', text: 'hello', at: 't' });

    const history = await engine.history('conv-a');

    expect(history.events).toEqual([{ type: 'user', text: 'hello', at: 't' }]);
    expect(history.missingModel).toBe(MODEL);
    expect(engine.active).toBeNull();
  });
});

describe('ConversationEngine — sending', () => {
  it('runs a turn, tags every event with the conversation, persists both sides', async () => {
    const { engine, store, events } = await makeRig({ replies: ['pong'] });
    await engine.open('conv-a', MODEL);

    await engine.send('conv-a', 'ping');

    expect(assistantText(events, 'conv-a')).toBe('pong');
    expect(turnEnded(events, 'conv-a')).toBe(true);
    const history = await engine.history('conv-a');
    expect(history.events.map((e) => [e.type, e.text])).toEqual([
      ['user', 'ping'],
      ['assistant', 'pong'],
    ]);
    expect((await store.meta('conv-a')).title).toBe('ping');
  });

  it('opens the conversation itself when nothing is open yet', async () => {
    const { engine, store, events } = await makeRig({ replies: ['pong'] });
    await store.create('conv-a', { modelPath: MODEL });

    await engine.send('conv-a', 'ping');

    expect(assistantText(events, 'conv-a')).toBe('pong');
    expect(engine.active).toBe('conv-a');
  });

  it('reports the missing model instead of running, and keeps nothing', async () => {
    const { engine, events } = await makeRig({ modelExists: false });
    await (await makeRig()).store.create('never', {});

    const outcome = await engine.send('conv-a', 'ping');

    expect(outcome).toEqual({ needsModel: true, conversationId: 'conv-a' });
    expect(events).toEqual([]);
  });
});

describe('ConversationEngine — a generation survives navigation', () => {
  it('browsing another conversation mid-stream neither cuts nor loses the reply', async () => {
    const { engine, store, events } = await makeRig({
      replies: ['one two three four five six seven eight'],
      paceMs: 15,
    });
    await store.create('conv-b', { modelPath: MODEL });
    await store.appendEvent('conv-b', { type: 'user', text: 'B says hi', at: 't' });
    await engine.open('conv-a', MODEL);

    const turn = engine.send('conv-a', 'count');
    await until(() => assistantText(events, 'conv-a').length > 0);

    // Navigation: read-only, answered immediately, while A still streams.
    const historyB = await engine.history('conv-b');
    expect(historyB.events[0]?.text).toBe('B says hi');
    expect(turnEnded(events, 'conv-a')).toBe(false);
    const partial = engine.inFlight();
    expect(partial?.conversationId).toBe('conv-a');
    expect(partial?.text.length).toBeGreaterThan(0);

    await turn;
    expect(engine.inFlight()).toBeNull();
    expect(assistantText(events, 'conv-a')).toBe('one two three four five six seven eight');
    const historyA = await engine.history('conv-a');
    expect(historyA.events.at(-1)?.text).toBe('one two three four five six seven eight');
  });

  it('opening another conversation waits for the turn in flight, then saves the state of the first', async () => {
    const { engine, kv, events } = await makeRig({
      replies: ['alpha beta gamma delta'],
      paceMs: 15,
    });
    await engine.open('conv-a', MODEL);
    const turn = engine.send('conv-a', 'go');
    await until(() => assistantText(events, 'conv-a').length > 0);

    const reply = await engine.open('conv-b', MODEL);

    expect(turnEnded(events, 'conv-a')).toBe(true);
    expect('needsModel' in reply).toBe(false);
    expect(engine.active).toBe('conv-b');
    expect(await kv.has('conv-a')).toBe(true);
    await turn;
  });

  it('cancel stops the stream; what arrived is kept', async () => {
    const { engine, events } = await makeRig({
      replies: ['one two three four five six seven eight nine ten'],
      paceMs: 20,
    });
    await engine.open('conv-a', MODEL);
    const turn = engine.send('conv-a', 'count');
    await until(() => assistantText(events, 'conv-a').length > 3);

    engine.cancel('conv-a');
    await turn;

    expect(engine.inFlight()).toBeNull();
    const text = assistantText(events, 'conv-a');
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan('one two three four five six seven eight nine ten'.length);
    const history = await engine.history('conv-a');
    expect(history.events.at(-1)?.type).toBe('assistant');
  });
});

describe('ConversationEngine — state', () => {
  it('saveState writes the manifest of the active conversation', async () => {
    const { engine, kv } = await makeRig();
    await engine.open('conv-a', MODEL);
    await engine.send('conv-a', 'hello');

    expect(await engine.saveState()).toBe(true);
    expect(await kv.has('conv-a')).toBe(true);
  });

  it('close saves, then leaves nothing active', async () => {
    const { engine, kv } = await makeRig();
    await engine.open('conv-a', MODEL);
    await engine.send('conv-a', 'hello');

    await engine.close();

    expect(await kv.has('conv-a')).toBe(true);
    expect(engine.active).toBeNull();
    expect(engine.inFlight()).toBeNull();
  });
});

describe('ConversationEngine — what this machine measured', () => {
  it('learns the prefill speed of a model from its turns, and the size of the open context', async () => {
    const { engine } = await makeRig({ msPerToken: 2 }); // the fake server: 2 ms per uncached token
    await engine.open('conv-a', MODEL);
    expect(engine.prefillRate(MODEL)).toBeUndefined();

    await engine.send('conv-a', 'a message long enough to be measured '.repeat(20));

    // 2 ms per token: 500 tokens per second.
    expect(engine.prefillRate(MODEL)).toBeCloseTo(500, -1);
    expect(engine.contextTokensOf('conv-a')).toBeGreaterThan(0);
    expect(engine.contextTokensOf('conv-b')).toBeUndefined();
  });

  it('keeps the speed in the measures it is given — the next launch knows it', async () => {
    const measures = new MeasureStore();
    measures.record(MODEL, { prefillTokensPerSecond: 1000 });
    const { engine } = await makeRig({ msPerToken: 2, measures });
    expect(engine.prefillRate(MODEL)).toBe(1000);
    await engine.open('conv-a', MODEL);

    await engine.send('conv-a', 'a message long enough to be measured '.repeat(20));

    // A running average of what it knew (1000) and what it saw (500).
    expect(measures.get(MODEL)?.prefillTokensPerSecond).toBeCloseTo(750, -1);
  });

  it('a restore says how long it took, and what computing it again would have cost (P2.8)', async () => {
    const measures = new MeasureStore();
    const { engine } = await makeRig({ msPerToken: 2, measures });
    await engine.open('conv-a', MODEL);
    await engine.send('conv-a', 'a message long enough to be measured '.repeat(20));
    await engine.close();

    const opened = await engine.open('conv-a', MODEL);

    if ('needsModel' in opened || !opened.restore.restored) throw new Error('expected a restore');
    expect(opened.restore.restoreMs).toBeGreaterThanOrEqual(0);
    // The restored tokens at the measured ~500 tokens per second: ~2 ms each.
    const ratio = (opened.restore.prefillEstimateMs ?? 0) / (opened.restore.nRestored * 2);
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.25);
  });

  it('a send that opens the conversation says what the open found — browsing only read the log', async () => {
    const { engine, events } = await makeRig({ msPerToken: 2, replies: ['one', 'two', 'three'] });
    await engine.open('conv-a', MODEL);
    await engine.send('conv-a', 'a first message long enough to be measured '.repeat(10));
    // Opened explicitly: the send opened nothing.
    expect(events.some((e) => e.event.type === 'session_opened')).toBe(false);
    await engine.close();
    events.length = 0;

    await engine.send('conv-a', 'and again');

    const opened = events.find((e) => e.conversationId === 'conv-a' && e.event.type === 'session_opened')?.event;
    if (opened?.type !== 'session_opened' || !opened.opened.restore.restored) throw new Error('expected a restore');
    expect(opened.opened.restore.restoreMs).toBeGreaterThanOrEqual(0);
    expect(opened.opened.restore.prefillEstimateMs).toBeGreaterThan(0);
    expect(opened.opened.contextTokens).toBe(opened.opened.restore.nRestored);
    // Before the turn's own events: the strip knows before the first token.
    expect(events.findIndex((e) => e.event.type === 'session_opened')).toBe(0);
    // A send on the conversation already open opens nothing.
    events.length = 0;
    await engine.send('conv-a', 'once more');
    expect(events.some((e) => e.event.type === 'session_opened')).toBe(false);
  });

  it('without a measured speed, a restore claims no comparison', async () => {
    const { engine } = await makeRig({ replies: ['ok'] });
    await engine.open('conv-a', MODEL);
    await engine.send('conv-a', 'hi');
    await engine.close();

    const opened = await engine.open('conv-a', MODEL);

    if ('needsModel' in opened || !opened.restore.restored) throw new Error('expected a restore');
    expect(opened.restore.restoreMs).toBeGreaterThanOrEqual(0);
    expect(opened.restore.prefillEstimateMs).toBeUndefined();
  });
});

describe('ConversationEngine — branches and duplicates (D-44)', () => {
  it('a duplicate inherits the saved state: its first turn is served from the cache', async () => {
    const { engine, store, kv, events } = await makeRig({ replies: ['first answer', 'second', 'third'] });
    await engine.open('conv-a', MODEL);
    await engine.send('conv-a', 'a question long enough to fill a few fake tokens');

    const outcome = await engine.branch('conv-a', 'conv-b', { title: 'A (copy)' });

    expect(outcome.inheritedState).toBe(true);
    expect(await kv.has('conv-b')).toBe(true);
    expect((await store.meta('conv-b')).parentId).toBe('conv-a');
    const opened = await engine.open('conv-b', MODEL);
    expect('needsModel' in opened ? null : opened.restore.restored).toBe(true);

    await engine.send('conv-b', 'and a follow-up');
    const end = events.filter((e) => e.conversationId === 'conv-b' && e.event.type === 'turn_end').at(-1)?.event;
    expect(end?.type === 'turn_end' && end.cachedTokens > 0).toBe(true);
  });

  it('a branch after a turn keeps the log up to it, and the parent keeps everything', async () => {
    const { engine, store } = await makeRig({ replies: ['one', 'two'] });
    await engine.open('conv-a', MODEL);
    await engine.send('conv-a', 'first');
    await engine.send('conv-a', 'second');

    await engine.branch('conv-a', 'conv-c', { title: 'A (branch)', afterTurn: 1 });

    const branch = await engine.history('conv-c');
    expect(branch.events.map((e) => [e.type, e.text])).toEqual([
      ['user', 'first'],
      ['assistant', 'one'],
    ]);
    expect((await engine.history('conv-a')).events).toHaveLength(4);
    expect((await store.meta('conv-c')).title).toBe('A (branch)');
  });
});

describe('ConversationEngine — compaction is the rebase (P2.5, D-19)', () => {
  it('summarises, restarts the prompt from the summary with a re-frozen system prompt, and drops the stale state', async () => {
    const prompts: string[] = [];
    const { engine, store, kv } = await makeRig({
      responder: (prompt) => {
        prompts.push(prompt);
        return prompt.includes('Summarize this conversation') ? 'SUMMARY OF THE WORK' : 'an answer';
      },
    });
    await engine.open('conv-a', MODEL);
    await engine.send('conv-a', 'first question');
    await engine.send('conv-a', 'second question');
    await engine.send('conv-a', 'third question');
    await engine.saveState();
    expect(await kv.has('conv-a')).toBe(true);

    const result = await engine.compact('conv-a', { keepTurns: 2 });

    expect(result).toMatchObject({ summary: 'SUMMARY OF THE WORK', compactedTurns: 4, keptTurns: 2 });
    const log = await store.loadEvents('conv-a');
    expect(log.at(-1)).toMatchObject({ type: 'rebase', summary: 'SUMMARY OF THE WORK' });
    // The summary request itself never enters the log.
    expect(JSON.stringify(log)).not.toContain('Summarize this conversation');
    // The saved state was built on the old prompt: gone.
    expect(await kv.has('conv-a')).toBe(false);
    expect(engine.active).toBeNull();

    // The screen keeps every turn, with the compaction marked.
    const history = await engine.history('conv-a');
    expect(history.events.map((event) => event.type)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
      'compaction',
    ]);
    expect(history.events.at(-1)?.text).toBe('SUMMARY OF THE WORK');

    // The next turn's prompt: a system block, the summary, the kept turns —
    // not the compacted ones.
    await engine.send('conv-a', 'fourth question');
    const next = prompts.at(-1) as string;
    expect(next.startsWith('<|im_start|>system')).toBe(true);
    expect(next).toContain('SUMMARY OF THE WORK');
    expect(next).toContain('third question');
    expect(next).not.toContain('first question');
    expect(next).not.toContain('second question');
  });

  it('a conversation that is not open is opened to be summarised', async () => {
    const { engine, store } = await makeRig({
      responder: (prompt) => (prompt.includes('Summarize this conversation') ? 'S' : 'a'),
    });
    await engine.open('conv-a', MODEL);
    await engine.send('conv-a', 'one');
    await engine.send('conv-a', 'two');
    await engine.open('conv-b', MODEL);

    await engine.compact('conv-a', { keepTurns: 0 });

    expect((await store.loadEvents('conv-a')).at(-1)).toMatchObject({ type: 'rebase', summary: 'S', keepFrom: 4 });
  });
});

describe('ConversationEngine — deleting a conversation', () => {
  it('erases the log, the meta and the saved state', async () => {
    const { engine, store, kv } = await makeRig();
    await engine.open('conv-a', MODEL);
    await engine.send('conv-a', 'secret');
    await engine.open('conv-b', MODEL); // conv-a leaves the slot: its state is saved
    expect(await kv.has('conv-a')).toBe(true);

    await engine.remove('conv-a');

    expect(await store.exists('conv-a')).toBe(false);
    expect(await kv.has('conv-a')).toBe(false);
    expect(engine.active).toBe('conv-b');
  });

  it('the open conversation lets go of the slot WITHOUT saving what it is about to erase', async () => {
    const { engine, store, kv } = await makeRig();
    await engine.open('conv-a', MODEL);
    await engine.send('conv-a', 'secret');

    await engine.remove('conv-a');

    expect(engine.active).toBeNull();
    expect(await kv.has('conv-a')).toBe(false);
    expect(await store.exists('conv-a')).toBe(false);
  });

  it('a turn in flight in that conversation is cut first — nothing is written after the erase', async () => {
    const { engine, store, events } = await makeRig({
      replies: ['one two three four five six seven eight nine ten'],
      paceMs: 20,
    });
    await engine.open('conv-a', MODEL);
    const turn = engine.send('conv-a', 'count');
    await until(() => assistantText(events, 'conv-a').length > 0);

    await engine.remove('conv-a');
    await turn;

    expect(engine.inFlight()).toBeNull();
    expect(await store.exists('conv-a')).toBe(false);
  });

  it('removing a conversation that does not exist is a no-op', async () => {
    const { engine } = await makeRig();
    await expect(engine.remove('never')).resolves.toBeUndefined();
  });
});

describe('ConversationEngine — the model of a conversation', () => {
  it('an explicit model replaces the pin: the composer can switch a conversation to another model', async () => {
    // Until now the pinned model always won over the one passed in, so the
    // composer's model menu silently did nothing on a pinned conversation.
    const { engine, store } = await makeRig();
    await engine.open('conv-a', MODEL);

    const reply = await engine.open('conv-a', 'D:\models\other.gguf');

    expect('needsModel' in reply).toBe(false);
    expect((await store.meta('conv-a')).modelPath).toBe('D:\models\other.gguf');
    expect(engine.active).toBe('conv-a');
  });
});

describe('ConversationEngine — closing during a turn', () => {
  it('close() cuts the turn in flight instead of waiting for it', async () => {
    // Quitting the app with a reply still streaming — or a tool call waiting
    // for consent — must not hang on the turn: it is cut, what arrived is
    // committed, the state is saved.
    const { engine, events } = await makeRig({
      replies: ['one two three four five six seven eight nine ten eleven twelve'],
      paceMs: 100,
    });
    await engine.open('conv-a', MODEL);
    const turn = engine.send('conv-a', 'go');
    await until(() => assistantText(events, 'conv-a').length > 0);

    const started = Date.now();
    await engine.close();

    expect(Date.now() - started).toBeLessThan(600);
    expect(engine.inFlight()).toBeNull();
    expect(engine.active).toBeNull();
    await turn;
  });
});

describe('ConversationEngine — the context is finite (D-22)', () => {
  const overflow = (events: TaggedEvent[]) =>
    events.find((e) => e.event.type === 'context_overflow')?.event;

  it('turn_end reports the context in use after the turn — prompt and reply together', async () => {
    const { engine, events } = await makeRig({ replies: ['a reply of several words here'] });
    await engine.open('conv-a', MODEL);

    await engine.send('conv-a', 'hello');

    const end = events.find((e) => e.event.type === 'turn_end')?.event;
    expect(end?.type).toBe('turn_end');
    if (end?.type !== 'turn_end') return;
    expect(end.promptTokens).toBeGreaterThan(0);
    expect(end.contextTokens).toBeGreaterThan(end.promptTokens);
  });

  it('refuses a message that cannot fit, before sending anything to the server', async () => {
    // Proactive guard: what the slot holds + the message + room for a reply
    // must fit in the server's context. Nothing is persisted, nothing sent.
    const { engine, store, events, turns } = await makeRig({ nCtx: 64 });
    await engine.open('conv-a', MODEL);

    await engine.send('conv-a', 'word '.repeat(400));

    const event = overflow(events);
    expect(event?.type).toBe('context_overflow');
    if (event?.type !== 'context_overflow') return;
    expect(event.nCtx).toBe(64);
    expect(event.needed).toBeGreaterThan(64);
    expect(turns()).toBe(0);
    expect((await store.loadEvents('conv-a')).filter((e) => e.type === 'user')).toHaveLength(0);
    expect(events.some((e) => e.event.type === 'error')).toBe(false);
  });

  it('a reply cut at the context ceiling is reported as truncated, not a clean end', async () => {
    // Paul, 2026-08-28: on a resumed conversation the model kept "stopping
    // before the end". The server cuts the generation at the context ceiling
    // (--no-context-shift, slot.truncated), and any stop was read as a clean
    // finish. The turn now carries the fact that it was cut.
    const { engine, events } = await makeRig({ replies: ['half an ans'], truncate: true });
    await engine.open('conv-a', MODEL);
    await engine.send('conv-a', 'go on');

    const end = events.find((e) => e.event.type === 'turn_end')?.event;
    expect(end?.type).toBe('turn_end');
    if (end?.type !== 'turn_end') return;
    expect(end.truncated).toBe(true);
  });

  it('a server that refuses the prompt as too long is reported as an overflow, not as an error', async () => {
    // Reactive guard: the estimate was optimistic, the server says no
    // (context shift is never left to it). Same event, same meaning.
    const { engine, events } = await makeRig({ serverNCtx: 30 });
    await engine.open('conv-a', MODEL);

    await engine.send('conv-a', 'hello');

    expect(overflow(events)?.type).toBe('context_overflow');
    expect(events.some((e) => e.event.type === 'error')).toBe(false);
  });

  it('a conversation may cap its own context below the server: the cap is what refuses', async () => {
    // Asked by Paul on 2026-08-28: choose the room a conversation may take,
    // and switch it on or off. The cap is a setting resolved by the host;
    // the server's size stays the ceiling.
    const { engine, events, turns } = await makeRig({
      nCtx: 4096,
      engine: { context: async () => ({ contextLimit: 64 }) },
    });
    await engine.open('conv-a', MODEL);

    await engine.send('conv-a', 'word '.repeat(400));

    const event = overflow(events);
    expect(event?.type).toBe('context_overflow');
    if (event?.type !== 'context_overflow') return;
    expect(event.limit).toBe(64);
    expect(event.nCtx).toBe(4096);
    expect(turns()).toBe(0);
  });

  it('a cap above the server context changes nothing: the server stays the ceiling', async () => {
    const { engine, events } = await makeRig({
      nCtx: 64,
      engine: { context: async () => ({ contextLimit: 100000 }) },
    });
    await engine.open('conv-a', MODEL);

    await engine.send('conv-a', 'word '.repeat(400));

    const event = overflow(events);
    expect(event?.type).toBe('context_overflow');
    if (event?.type !== 'context_overflow') return;
    expect(event.limit).toBe(64);
  });
});

describe('ConversationEngine — a shared prefix seeds every fresh conversation', () => {
  // Paul, 2026-08-28: "start from something ready-made, since the system
  // prompt is the same". The property was proved for real on 2026-08-28
  // (545 of 545 saved tokens reused by a branch): a restored state serves
  // as the prefix of a longer, different prompt. So the first conversation
  // of a (model, tools, project) prefills the system prompt once and saves
  // it as a seed; every later one restores the seed and only prefills what
  // is its own.
  it('the first fresh conversation prepares the seed, the next one starts from it', async () => {
    const { engine, disk, events } = await makeRig({ replies: ['first', 'second'] });

    const first = await engine.open('conv-a', MODEL);
    expect(first).toMatchObject({ seed: { restored: false, created: true } });
    if (!('seed' in first) || !first.seed) return;
    expect(first.seed.restored === false && first.seed.created ? first.seed.nTokens : 0).toBeGreaterThan(0);
    expect([...disk.keys()].some((name) => name.startsWith('seed-'))).toBe(true);
    // The slot holds the prefix already: the gauge says so at open.
    expect(first.contextTokens).toBeGreaterThan(0);

    const second = await engine.open('conv-b', MODEL);
    expect(second).toMatchObject({ restore: { restored: false }, seed: { restored: true } });
    if (!('seed' in second) || !second.seed?.restored) return;
    expect(second.seed.nRestored).toBe(first.contextTokens);

    await engine.send('conv-b', 'hello');
    const end = events.find((e) => e.conversationId === 'conv-b' && e.event.type === 'turn_end')?.event;
    expect(end?.type).toBe('turn_end');
    if (end?.type !== 'turn_end') return;
    // The first turn of the second conversation was served from the seed.
    expect(end.cachedTokens).toBeGreaterThanOrEqual(second.seed.nRestored);
  });

  it('a conversation with a state of its own does not touch the seed', async () => {
    const { engine } = await makeRig({ replies: ['one', 'two'] });
    await engine.open('conv-a', MODEL);
    await engine.send('conv-a', 'hello');
    await engine.saveState();
    await engine.open('conv-b', MODEL);

    const back = await engine.open('conv-a', MODEL);
    expect(back).toMatchObject({ restore: { restored: true } });
    expect('seed' in back ? back.seed : undefined).toBeUndefined();
  });
});

describe('readableEvents — a turn reads back the way it was seen', () => {
  it('keeps the tool calls, their results and the reasoning of a turn, in order, as one assistant event', async () => {
    // Reported by Paul on 2026-08-28: after a reload the tool calls of the
    // earlier turns had vanished from the conversation — the reader kept
    // the text only. What was seen live must read back the same.
    const { readableEvents } = await import('./conversation-engine.js');
    const events = readableEvents([
      { type: 'user', text: 'read the config', at: 't1' },
      {
        type: 'assistant',
        entry: {
          role: 'assistant',
          text: '',
          thinking: 'I should read it first.',
          reasoning: true,
          calls: [{ name: 'read_file', arguments: { path: 'config.json' } }],
        },
        at: 't2',
      },
      {
        type: 'tool_results',
        entry: { role: 'tool_results', results: [{ name: 'read_file', ok: true, content: '{"a":1}' }] },
        at: 't3',
      },
      { type: 'assistant', entry: { role: 'assistant', text: 'The config sets a to 1.', reasoning: true }, at: 't4' },
      { type: 'service', text: 'inventory changed', at: 't5' },
    ]);

    expect(events.map((e) => e.type)).toEqual(['user', 'assistant']);
    const turn = events[1]!;
    expect(turn.text).toBe('The config sets a to 1.');
    expect(turn.at).toBe('t2');
    expect(turn.segments).toEqual([
      { kind: 'thinking', text: 'I should read it first.' },
      { kind: 'tool', name: 'read_file', args: { path: 'config.json' }, ok: true, content: '{"a":1}' },
      { kind: 'text', text: 'The config sets a to 1.' },
    ]);
  });

  it('a turn cut before any text still shows what it did', async () => {
    const { readableEvents } = await import('./conversation-engine.js');
    const events = readableEvents([
      { type: 'user', text: 'go', at: 't1' },
      {
        type: 'assistant',
        entry: { role: 'assistant', text: '', calls: [{ name: 'run_shell', arguments: { command: 'ls' } }] },
        at: 't2',
      },
      {
        type: 'tool_results',
        entry: { role: 'tool_results', results: [{ name: 'run_shell', ok: false, content: 'The user declined this action: run_shell.' }] },
        at: 't3',
      },
    ]);

    expect(events).toHaveLength(2);
    expect(events[1]?.segments).toEqual([
      { kind: 'tool', name: 'run_shell', args: { command: 'ls' }, ok: false, content: 'The user declined this action: run_shell.' },
    ]);
    expect(events[1]?.text).toBe('');
  });
});

describe('readableEvents — attachments read back as names, not contents', () => {
  it('a user message shows its text and its files by name', () => {
    const events = readableEvents([
      { type: 'user', text: 'see file', attachments: [{ name: 'notes.md', content: 'LONG CONTENT' }], at: 't' },
    ]);
    expect(events).toEqual([{ type: 'user', text: 'see file', at: 't', attachments: ['notes.md'] }]);
  });
});

describe('ConversationEngine — the file changes of a turn can be undone (06 §1 D, Q-19)', () => {
  it('reports the files a turn wrote, and undo puts them back and tells the model', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bp-ckpt-repo-'));
    const data = await mkdtemp(join(tmpdir(), 'bp-ckpt-data-'));
    dirs.push(repo, data);
    await writeFile(join(repo, 'a.txt'), 'OLD', 'utf8');
    const registry = new ToolRegistry();
    for (const tool of builtinTools()) registry.register(tool.def, tool.handler, 'builtin');
    const { engine, store, events } = await makeRig({
      replies: [
        '<tool_call>{"name": "write_file", "arguments": {"path": "a.txt", "content": "NEW"}}</tool_call>',
        'written',
      ],
      engine: {
        registry,
        permissions: new PermissionEngine('impro'),
        rootsOf: async () => [repo],
        checkpoints: new CheckpointStore(data),
      },
    });
    await engine.open('conv-a', MODEL);

    await engine.send('conv-a', 'write it');

    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('NEW');
    const changed = events.find((e) => e.event.type === 'files_changed')?.event;
    expect(changed).toMatchObject({ type: 'files_changed', files: ['a.txt'] });
    const turnId = changed?.type === 'files_changed' ? changed.turnId : '';

    const result = await engine.undoTurn('conv-a', turnId);

    expect(result).toEqual({ restored: ['a.txt'], conflicts: [] });
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('OLD');
    // The model is told — or it would believe its edit is still there.
    const log = await store.loadEvents('conv-a');
    expect(log.at(-1)).toMatchObject({ type: 'service' });
    expect((log.at(-1) as { text: string }).text).toContain('a.txt');
    // And the history says so, for the screen.
    const history = await engine.history('conv-a');
    expect(history.events.find((e) => e.type === 'assistant')?.changes).toEqual({
      turnId,
      files: ['a.txt'],
      undone: true,
    });
  });
});

describe('ConversationEngine — a change while a reply streams (adversarial reviews, 2026-09-26)', () => {
  const words = Array.from({ length: 30 }, (_, i) => `w${i} `).join('') + 'END';
  const lastTurnEnd = (events: TaggedEvent[]) => {
    const end = events.filter((e) => e.event.type === 'turn_end').at(-1)?.event;
    if (end?.type !== 'turn_end') throw new Error('no turn_end');
    return end;
  };

  it('invalidate() lets the reply finish; the next message reopens with the new context, from the warm slot', async () => {
    let contextCalls = 0;
    const { engine, events } = await makeRig({
      paceMs: 10,
      replies: [words, 'second'],
      engine: {
        context: async () => {
          contextCalls++;
          return { replyLanguage: 'English' };
        },
      },
    });
    await engine.open('conv-a', MODEL);
    const pending = engine.send('conv-a', 'first');
    await until(() => assistantText(events, 'conv-a').includes('w3 '));

    engine.invalidate();
    await pending;

    expect(assistantText(events, 'conv-a')).toContain('END');
    const held = lastTurnEnd(events).contextTokens;
    const callsBefore = contextCalls;
    events.length = 0;
    await engine.send('conv-a', 'next');
    // Reopened with the context read anew…
    expect(contextCalls).toBeGreaterThan(callsBefore);
    // …but nothing restored: the slot already held the conversation.
    expect(lastTurnEnd(events).cachedTokens).toBeGreaterThanOrEqual(held - 1);
    expect(events.some((e) => e.event.type === 'session_opened')).toBe(false);
  });

  it('opening the conversation already in the slot restores nothing over it', async () => {
    const { engine, events } = await makeRig({ replies: ['a fairly long answer '.repeat(30)] });
    await engine.open('conv-a', MODEL);
    for (const message of ['one', 'two', 'three']) await engine.send('conv-a', message);
    const held = lastTurnEnd(events).contextTokens;

    const reopened = await engine.open('conv-a', MODEL);

    if ('needsModel' in reopened) throw new Error('needs model');
    expect(reopened.restore).toEqual({ restored: false, reason: 'warm' });
    expect(reopened.contextTokens).toBe(held);
    await engine.send('conv-a', 'four');
    expect(lastTurnEnd(events).cachedTokens).toBeGreaterThanOrEqual(held - 1);
  });

  it('a tool that appears mid-turn is announced at the next message — never recorded as known in silence', async () => {
    const registry = new ToolRegistry();
    const prompts: string[] = [];
    const { engine, events } = await makeRig({
      paceMs: 10,
      responder: (prompt) => {
        prompts.push(prompt);
        return prompts.length === 1 ? words : 'ok';
      },
      engine: { registry },
    });
    await engine.open('conv-a', MODEL);
    const pending = engine.send('conv-a', 'first');
    await until(() => assistantText(events, 'conv-a').includes('w3 '));
    registry.register(
      { name: 'late_tool', description: 'Appeared mid-turn.', inputSchema: { type: 'object', properties: {} }, effect: 'read' },
      async () => ({ ok: true, content: '' }),
      'mcp',
    );
    await pending;
    expect(assistantText(events, 'conv-a')).toContain('END');

    await engine.send('conv-a', 'what can you do now?');

    expect(prompts.at(-1)).toContain('late_tool');
  });
});

describe('ConversationEngine — after a failed request (adversarial review, 2026-09-26)', () => {
  it('the next message still reaches the model', async () => {
    let deny = false;
    const prompts: string[] = [];
    const { engine } = await makeRig({
      responder: (prompt) => {
        prompts.push(prompt);
        return 'ok';
      },
      // Another key than the launch's: the server answers 401 to that request.
      server: { apiKey: () => (deny ? 'not-our-key' : undefined) },
    });
    await engine.open('conv-a', MODEL);
    await engine.send('conv-a', 'first message');
    deny = true;
    await engine.send('conv-a', 'second message').catch(() => undefined);
    deny = false;

    await engine.send('conv-a', 'third message');

    expect(prompts.at(-1)).toContain('third message');
  });
});

describe('ConversationEngine — one thing at a time (adversarial review, 2026-09-26)', () => {
  const words = Array.from({ length: 30 }, (_, i) => `w${i} `).join('');

  it('two messages to a conversation not open yet start the server once, and both reach the model', async () => {
    const prompts: string[] = [];
    const { engine, store } = await makeRig({
      responder: (prompt) => {
        prompts.push(prompt);
        return 'ok';
      },
    });
    await store.create('conv-a', { modelPath: MODEL });
    spawns = 0;

    await Promise.all([engine.send('conv-a', 'first message'), engine.send('conv-a', 'second message')]);

    expect(spawns).toBe(1);
    expect(prompts.some((p) => p.includes('first message'))).toBe(true);
    expect(prompts.some((p) => p.includes('second message'))).toBe(true);
  });

  it('a slow open does not let a second message open a second session — neither is lost', async () => {
    let calls = 0;
    const prompts: string[] = [];
    const { engine, store } = await makeRig({
      paceMs: 5,
      responder: (prompt) => {
        prompts.push(prompt);
        return 'reply';
      },
      engine: {
        context: async () => {
          if (calls++ === 0) await new Promise((resolve) => setTimeout(resolve, 300));
          return { replyLanguage: 'English' };
        },
      },
    });
    await store.create('conv-a', { modelPath: MODEL });
    const one = engine.send('conv-a', 'message one');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const two = engine.send('conv-a', 'message two');
    await Promise.all([one, two]);

    expect(prompts.some((p) => p.includes('message one'))).toBe(true);
    expect(prompts.some((p) => p.includes('message two'))).toBe(true);
  });

  it('Stop stops the turn that streams — not the one waiting behind it', async () => {
    const { engine, events } = await makeRig({ paceMs: 15, replies: [words, 'second reply'] });
    await engine.open('conv-a', MODEL);
    const one = engine.send('conv-a', 'one');
    const two = engine.send('conv-a', 'two');
    await until(() => assistantText(events, 'conv-a').includes('w3 '));

    engine.cancel('conv-a');
    await Promise.all([one, two]);

    expect(assistantText(events, 'conv-a')).not.toContain('w29');
    expect(assistantText(events, 'conv-a')).toContain('second reply');
  });
});

describe('ConversationEngine — a message the server refuses (adversarial review, 2026-09-26)', () => {
  const overflows = (events: TaggedEvent[]) => events.filter((e) => e.event.type === 'context_overflow').length;

  it('is withdrawn: the next message reaches the model without it, and the log reads without it', async () => {
    const prompts: string[] = [];
    const { engine, events, store } = await makeRig({
      // The engine believes 4096; the server holds 300 — its refusal is the safety net.
      serverNCtx: 300,
      responder: (prompt) => {
        prompts.push(prompt);
        return 'ok';
      },
    });
    await engine.open('conv-a', MODEL);
    await engine.send('conv-a', 'hello');
    await engine.send('conv-a', '1234567890'.repeat(120));
    expect(overflows(events)).toBe(1);

    await engine.send('conv-a', 'short question');

    expect(overflows(events)).toBe(1);
    expect(prompts.at(-1)).toContain('short question');
    expect(prompts.at(-1)).not.toContain('1234567890');
    const history = await engine.history('conv-a');
    expect(history.events.map((e) => e.text)).not.toContain('1234567890'.repeat(120));
    void store;
  });

  it('a cancelled turn counts what its prefill read: a resend is refused before anything is sent', async () => {
    const { engine, events } = await makeRig({
      nCtx: 4096,
      serverNCtx: 4096,
      server: { prefillBatch: 200, prefillPaceMs: 30 },
    });
    await engine.open('conv-a', MODEL);
    await engine.send('conv-a', 'hello');
    const big = 'lorem ipsum dolor sit amet '.repeat(300);
    events.length = 0;
    const pending = engine.send('conv-a', big);
    await until(() => events.some((e) => e.event.type === 'prefill'));
    engine.cancel('conv-a');
    await pending;

    await engine.send('conv-a', big);
    await engine.send('conv-a', 'ok, forget it — just say hi');

    // The resend is refused by the engine's own check (nothing persisted);
    // the short message after it goes through.
    expect(overflows(events)).toBe(1);
    expect(events.filter((e) => e.event.type === 'turn_end').length).toBeGreaterThanOrEqual(2);
  });
});

describe('ConversationEngine — a branch counts its own prompt (adversarial review, 2026-09-26)', () => {
  it('branching early from a long conversation does not refuse every message', async () => {
    const long = 'word '.repeat(2600);
    let calls = 0;
    const { engine, events } = await makeRig({
      responder: () => (calls++ === 1 ? long : 'short answer'),
    });
    await engine.open('src', MODEL);
    await engine.send('src', 'hello');
    await engine.send('src', 'go on');
    await engine.branch('src', 'br', { title: 'branch', afterTurn: 1 });

    const opened = await engine.open('br', MODEL);
    events.length = 0;
    await engine.send('br', 'a new question for the branch');

    if ('needsModel' in opened) throw new Error('needs model');
    expect(opened.contextTokens).toBeLessThan(1000);
    expect(events.find((e) => e.event.type === 'context_overflow')).toBeUndefined();
  });
});
