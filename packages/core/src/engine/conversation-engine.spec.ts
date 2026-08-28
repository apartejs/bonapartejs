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

import { mkdtemp, rm } from 'node:fs/promises';
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
  type FakeSlotSnapshot,
} from '../testing/fake-llama-server.js';
import { ToolRegistry } from '../tools/registry.js';
import {
  ConversationEngine,
  type ConversationEngineOptions,
  type TaggedEvent,
} from './conversation-engine.js';
import { EngineSupervisor } from './supervisor.js';

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

const fakeSpawn: SpawnFn = () => {
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
    modelExists?: boolean;
    engine?: Partial<ConversationEngineOptions>;
  } = {},
): Promise<Rig> {
  let turn = 0;
  const replies = options.replies ?? ['ok'];
  const disk = new Map<string, FakeSlotSnapshot>();
  const server = await startFakeLlamaServer({
    msPerToken: options.msPerToken ?? 2,
    ...(options.paceMs !== undefined ? { paceMs: options.paceMs } : {}),
    ...(options.serverNCtx !== undefined ? { nCtx: options.serverNCtx } : {}),
    responder: () => replies[Math.min(turn++, replies.length - 1)] ?? '',
    files: disk,
  });
  servers.push(server);

  const dir = await mkdtemp(join(tmpdir(), 'bp-conv-engine-'));
  dirs.push(dir);

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

  it('a server that refuses the prompt as too long is reported as an overflow, not as an error', async () => {
    // Reactive guard: the estimate was optimistic, the server says no
    // (context shift is never left to it). Same event, same meaning.
    const { engine, events } = await makeRig({ serverNCtx: 30 });
    await engine.open('conv-a', MODEL);

    await engine.send('conv-a', 'hello');

    expect(overflow(events)?.type).toBe('context_overflow');
    expect(events.some((e) => e.event.type === 'error')).toBe(false);
  });
});
