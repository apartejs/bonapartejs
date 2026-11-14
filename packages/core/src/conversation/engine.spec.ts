/**
 * The conversation engine: a turn of a conversation on the built-in engine.
 * It freezes the system prompt once, appends each message and each answer
 * to the journal with the text it froze, takes the slot through the
 * scheduler, finds the conversation's memory there (its state, or the seed
 * of a new one), and says what opening costs before paying it. It never
 * shifts the context, and a failure keeps what was said.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LlamaCppHttpClient } from '../backend/llamacpp/http-client.js';
import { familyLayer } from '../families/index.js';
import { frozenPrompt, openJournal } from '../journal/journal.js';
import { KvStore, type LiveConfig } from '../kv/kv-store.js';
import { startFakeLlamaServer, type FakeLlamaServer, type FakeLlamaServerOptions } from '../testing/fake-llama-server.js';
import { ConversationEngine, ContextFullError, EngineFailedError, type TurnEvent } from './engine.js';
import { ConversationStore } from './store.js';

const LIVE: LiveConfig = { modelFingerprint: 'fp-gemma', nCtx: 8192, cacheTypeK: 'f16', cacheTypeV: 'f16' };
const gemma = familyLayer('gemma');

let servers: FakeLlamaServer[] = [];
let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  servers = [];
  dirs = [];
});

async function rig(options: { server?: FakeLlamaServerOptions; live?: LiveConfig | null; dir?: string } = {}) {
  const dir = options.dir ?? (await mkdtemp(join(tmpdir(), 'bp-engine-')));
  if (!options.dir) dirs.push(dir);
  const kvDir = join(dir, 'kv-slots');
  const prompts: string[] = [];
  const server = await startFakeLlamaServer({
    slotDir: kvDir,
    responder: () => 'Bonjour Paul.',
    onCompletion: (body) => prompts.push(String(body['prompt'])),
    ...options.server,
  });
  servers.push(server);
  const client = new LlamaCppHttpClient(server.url);
  const store = new ConversationStore(join(dir, 'conversations'));
  const kv = new KvStore(kvDir);
  const live = options.live === undefined ? LIVE : options.live;
  const engine = new ConversationEngine({
    store,
    kv,
    engine: async () => ({ client, family: gemma, live, modelPath: 'gemma.gguf', kvBytesPerToken: 100 }),
    prompt: () => ({ kind: 'code', tools: [], perimeter: [], replyLanguage: 'French' }),
  });
  const conversation = () => store.create({ kind: 'code', engineId: 'builtin', modelId: 'gemma', mode: 'repetition' });
  const say = async (id: string, text: string, signal?: AbortSignal) => {
    const events: TurnEvent[] = [];
    const result = await engine.turn(id, { text }, (event) => events.push(event), signal);
    return { result, events };
  };
  return { dir, server, client, store, kv, engine, prompts, conversation, say };
}

describe('ConversationEngine — a turn', () => {
  it('freezes the system prompt once, then each message and each answer, with the text it froze', async () => {
    const { store, engine, prompts, conversation, say } = await rig();
    const meta = await conversation();
    await say(meta.id, 'Bonjour');
    await say(meta.id, 'Et ensuite ?');
    const journal = await openJournal(store.dir, meta.id);
    expect(journal.entries().map((entry) => entry.kind)).toEqual(['system', 'system', 'user', 'assistant', 'user', 'assistant']);
    // Each turn's prompt extends the last one, byte for byte; the journal holds exactly it.
    expect(prompts[1]!.startsWith(prompts[0]!)).toBe(true);
    expect(frozenPrompt(journal.entries()).startsWith(prompts[1]!)).toBe(true);
    expect(frozenPrompt(journal.entries())).toContain('Et ensuite ?');
    expect(await engine.open(meta.id)).toBeNull();
  });

  it('streams what the model writes, and gives the usage of the turn', async () => {
    const { conversation, say } = await rig();
    const meta = await conversation();
    const { result, events } = await say(meta.id, 'Bonjour');
    expect(events.filter((event) => event.type === 'text').map((event) => (event.type === 'text' ? event.delta : '')).join('')).toBe(
      'Bonjour Paul.',
    );
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });
});

describe('ConversationEngine — the memory', () => {
  it('a new conversation starts from the seed: prepared by the first, restored by the next', async () => {
    const { kv, conversation, say } = await rig();
    const first = await conversation();
    await say(first.id, 'Bonjour');
    const second = await conversation();
    const { result, events } = await say(second.id, 'Salut');
    expect(events).toContainEqual({ type: 'step', name: 'seed', phase: 'start' });
    expect(result.usage.cacheReadTokens).toBeGreaterThan(20);
    const seeds = await kv.usage();
    expect(seeds.entries.some((entry) => entry.kind === 'seed')).toBe(true);
  });

  it('going from A to B and back: A is saved, then restored from its state, served by the cache', async () => {
    const { kv, conversation, say } = await rig();
    const a = await conversation();
    const b = await conversation();
    await say(a.id, 'Bonjour');
    await say(b.id, 'Salut');
    expect(await kv.manifest(`${a.id}_main`)).not.toBeNull();
    const { result, events } = await say(a.id, 'Et ensuite ?');
    expect(events).toContainEqual({ type: 'step', name: 'restore', phase: 'start' });
    expect(result.usage.cacheReadTokens).toBeGreaterThan(30);
  });

  it('saves the conversation in the slot when the app closes, and announces its restore at the next launch', async () => {
    const first = await rig();
    const meta = await first.conversation();
    await first.say(meta.id, 'Bonjour');
    await first.engine.flush();
    const again = await rig({ dir: first.dir });
    const announcement = await again.engine.open(meta.id);
    expect(announcement).toMatchObject({ kind: 'restore', tokens: expect.any(Number) });
    // Opening touched no slot: the server of the new launch holds nothing.
    expect(again.server.getSlotTokens(0)).toEqual([]);
  });

  it('with a server that already runs, saves and restores nothing, and announces nothing', async () => {
    const { server, engine, conversation, say } = await rig({ live: null });
    const a = await conversation();
    const b = await conversation();
    await say(a.id, 'Bonjour');
    await say(b.id, 'Salut');
    await say(a.id, 'Et ensuite ?');
    await engine.flush();
    expect(server.files.size).toBe(0);
    expect(await engine.open(b.id)).toBeNull();
  });
});

describe('ConversationEngine — when it does not go well', () => {
  it('never shifts the context: a message that does not fit is refused before anything is sent', async () => {
    const { store, server, conversation, say } = await rig({ live: { ...LIVE, nCtx: 1300 } });
    const meta = await conversation();
    const before = server.finished;
    await expect(say(meta.id, 'long '.repeat(400))).rejects.toBeInstanceOf(ContextFullError);
    await expect(say(meta.id, 'long '.repeat(400))).rejects.toMatchObject({ announcement: { kind: 'context-full' } });
    expect(server.finished).toBe(before);
    expect((await openJournal(store.dir, meta.id)).entries().filter((entry) => entry.kind === 'user')).toEqual([]);
  });

  it("respects a conversation's own cap, below the engine's context", async () => {
    const { store, conversation, say } = await rig();
    const meta = await conversation();
    await store.update(meta.id, { contextCap: 1300 });
    await expect(say(meta.id, 'long '.repeat(400))).rejects.toBeInstanceOf(ContextFullError);
  });

  it('a message the server refuses as too long is withdrawn, and the conversation goes on', async () => {
    const { store, conversation, say } = await rig({ server: { nCtx: 400 } });
    const meta = await conversation();
    await expect(say(meta.id, 'mot '.repeat(300))).rejects.toBeInstanceOf(ContextFullError);
    const { result } = await say(meta.id, 'Bonjour');
    expect(result.stopped).toBeUndefined();
    const journal = await openJournal(store.dir, meta.id);
    expect(journal.entries().filter((entry) => entry.kind === 'user').map((entry) => (entry.kind === 'user' ? entry.text : ''))).toEqual([
      'Bonjour',
    ]);
  });

  it('the engine dying mid-answer: the message stays, the partial answer is kept, and reopening announces a re-read', async () => {
    const { store, engine, conversation, say } = await rig({
      server: { failAfter: 2, responder: () => 'un deux trois quatre cinq' },
    });
    const meta = await conversation();
    await expect(say(meta.id, 'Compte')).rejects.toBeInstanceOf(EngineFailedError);
    const entries = (await openJournal(store.dir, meta.id)).entries();
    expect(entries.map((entry) => entry.kind)).toEqual(['system', 'system', 'user', 'assistant']);
    expect(entries.at(-1)).toMatchObject({ kind: 'assistant', raw: 'un deux ', stopped: 'engine' });
    expect(await engine.open(meta.id)).toMatchObject({ kind: 'reread', reason: 'engine-died' });
  });

  it('Stop keeps what arrived, marked as stopped by the person', async () => {
    const { store, engine, conversation } = await rig({
      server: { paceMs: 30, responder: () => 'un deux trois quatre cinq six sept huit' },
    });
    const meta = await conversation();
    const controller = new AbortController();
    // Stopped once the first words are on the screen.
    const result = await engine.turn(
      meta.id,
      { text: 'Compte' },
      (event) => {
        if (event.type === 'text' && !controller.signal.aborted) controller.abort();
      },
      controller.signal,
    );
    expect(result.stopped).toBe('user');
    const last = (await openJournal(store.dir, meta.id)).entries().at(-1);
    expect(last).toMatchObject({ kind: 'assistant', stopped: 'user' });
    expect(last?.kind === 'assistant' ? last.raw.length : 0).toBeGreaterThan(0);
  });
});

describe('ConversationEngine — removing', () => {
  it('removes a conversation whole: its journal, its state, and nothing of it is saved after', async () => {
    const { store, kv, engine, conversation, say } = await rig();
    const a = await conversation();
    const b = await conversation();
    await say(a.id, 'Bonjour');
    await say(b.id, 'Salut');
    await say(a.id, 'Encore');
    await engine.remove(a.id);
    expect(await store.get(a.id)).toBeNull();
    expect(await kv.manifest(`${a.id}_main`)).toBeNull();
    // B takes the slot: what it held for A is not written back.
    await say(b.id, 'Et toi ?');
    await engine.flush();
    expect(await kv.manifest(`${a.id}_main`)).toBeNull();
  });
});

describe('ConversationEngine — branches', () => {
  it('asking the last answer again: a branch after the last message, served by the cache up to it', async () => {
    const { store, engine, conversation, say } = await rig({ server: { responder: () => `réponse ${Math.random()}` } });
    const meta = await conversation();
    await say(meta.id, 'Bonjour');
    await say(meta.id, 'Et ensuite ?');
    const before = (await openJournal(store.dir, meta.id)).entries();
    const lastUser = before.findLast((entry) => entry.kind === 'user')!;

    const result = await engine.turn(meta.id, { forkAfter: lastUser.id }, () => undefined);
    // Only the opening of the answer was read: everything up to the message came from the cache.
    expect(result.usage.inputTokens - (result.usage.cacheReadTokens ?? 0)).toBeLessThan(10);
    const branchId = (await store.get(meta.id))!.branchId;
    expect(branchId).not.toBe('main');
    const branch = (await openJournal(store.dir, meta.id, branchId)).entries();
    expect(branch.map((entry) => entry.kind)).toEqual(['system', 'system', 'user', 'assistant', 'user', 'assistant']);
    expect(branch.at(-1)).not.toEqual(before.at(-1));
    // The answer before is still there, in the branch it belongs to.
    expect((await openJournal(store.dir, meta.id, 'main')).entries()).toEqual(before);
  });

  it('a message changed: a branch where it stood, the new text from there, the old suite kept', async () => {
    const { store, engine, conversation, say } = await rig();
    const meta = await conversation();
    await say(meta.id, 'Bonjour');
    await say(meta.id, 'Et ensuite ?');
    const firstAnswer = (await openJournal(store.dir, meta.id)).entries().find((entry) => entry.kind === 'assistant')!;
    await engine.turn(meta.id, { text: 'Autre chose', forkAfter: firstAnswer.id }, () => undefined);
    const branchId = (await store.get(meta.id))!.branchId;
    const texts = (await openJournal(store.dir, meta.id, branchId))
      .entries()
      .flatMap((entry) => (entry.kind === 'user' ? [entry.text] : []));
    expect(texts).toEqual(['Bonjour', 'Autre chose']);
    const old = (await openJournal(store.dir, meta.id, 'main')).entries().flatMap((entry) => (entry.kind === 'user' ? [entry.text] : []));
    expect(old).toEqual(['Bonjour', 'Et ensuite ?']);
  });
});
