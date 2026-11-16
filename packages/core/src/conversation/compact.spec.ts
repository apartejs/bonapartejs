/**
 * Compaction is a rebase (task 7.3): the conversation summarised by the
 * model, asked as the conversation itself (its memory serves the prefix),
 * then a `rebase` entry that freezes the system prompt again with the truth
 * of the moment, the summary as a note, and the last two turns as they were
 * frozen — unless they weigh more than half. Nothing changes on a summary
 * cut or empty, nor when the gain is not worth it. The next turn reads from
 * the rebase; the memory of the old prompt is let go.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlayMode } from '@aparte/bonaparte-shared';
import { afterEach, describe, expect, it } from 'vitest';
import { LlamaCppHttpClient } from '../backend/llamacpp/http-client.js';
import { familyLayer } from '../families/index.js';
import { frozenPrompt, openJournal } from '../journal/journal.js';
import { KvStore, type LiveConfig } from '../kv/kv-store.js';
import { fakeTokenize, startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';
import { CompactionError, SUMMARY_QUESTION } from './compact.js';
import { ConversationEngine } from './engine.js';
import { ConversationStore } from './store.js';

const LIVE: LiveConfig = { modelFingerprint: 'fp-gemma', nCtx: 32_768, cacheTypeK: 'f16', cacheTypeV: 'f16' };
const gemma = familyLayer('gemma');
const LONG = 'Une longue explication du travail fait. '.repeat(160);

let servers: FakeLlamaServer[] = [];
let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  servers = [];
  dirs = [];
});

async function rig(options: { summary?: string; truncate?: boolean; mode?: PlayMode } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bp-compact-'));
  dirs.push(dir);
  const kvDir = join(dir, 'kv-slots');
  const prompts: string[] = [];
  const server = await startFakeLlamaServer({
    slotDir: kvDir,
    responder: (prompt) => (prompt.includes(SUMMARY_QUESTION) ? (options.summary ?? 'RÉSUMÉ : le format des heures est corrigé.') : LONG),
    onCompletion: (body) => prompts.push(String(body['prompt'])),
    ...(options.truncate ? { truncate: true } : {}),
  });
  servers.push(server);
  const client = new LlamaCppHttpClient(server.url);
  const store = new ConversationStore(join(dir, 'conversations'));
  const kv = new KvStore(kvDir);
  const engine = new ConversationEngine({
    store,
    kv,
    engine: async () => ({ client, family: gemma, live: LIVE, modelPath: 'gemma.gguf', kvBytesPerToken: 100, generation: 1, slidingWindow: 1024 }),
    prompt: () => ({ kind: 'code', tools: [], perimeter: [], replyLanguage: 'French' }),
    ...(options.mode ? { mode: async () => options.mode! } : {}),
  });
  const { id } = await store.create({ kind: 'code', engineId: 'builtin', modelId: 'gemma', mode: 'plume' });
  const say = (text: string) => engine.turn(id, { text }, () => undefined);
  const entries = async () => (await openJournal(store.dir, id, (await store.get(id))!.branchId)).entries();
  return { id, engine, kv, store, prompts, say, entries };
}

describe('compaction is a rebase', { timeout: 30_000 }, () => {
  it('asks the summary to keep, word for word, the facts read in files and from tools (task 7.5: a real model lost a code word)', () => {
    expect(SUMMARY_QUESTION).toMatch(/"Facts:" — quote exactly, never paraphrase, each specific fact read in a file, from a tool or from the user/);
    // Short enough to fit its cap: asked to keep every fact, a real model wrote past 1 536 tokens.
    expect(SUMMARY_QUESTION).toMatch(/at most 500 words/i);
  });

  it('summarises, then the prompt starts again from the system prompt and the summary — the early turns gone', async () => {
    const { id, engine, prompts, say, entries } = await rig();
    await say('Premier message.');
    await say('Deuxième message.');
    await say('Troisième message.');
    await say('Quatrième message.');
    const result = await engine.compact(id, () => undefined);
    expect(result).toMatchObject({ summary: 'RÉSUMÉ : le format des heures est corrigé.', compactedTurns: 4, keptTurns: 0 });
    const now = await entries();
    expect(now.at(-1)).toMatchObject({ kind: 'rebase', summary: 'RÉSUMÉ : le format des heures est corrigé.' });
    // The question asked for the summary is never part of the conversation.
    expect(JSON.stringify(now)).not.toContain(SUMMARY_QUESTION);

    await say('Et ensuite ?');
    const next = prompts.at(-1)!;
    expect(next.startsWith('<|turn>system')).toBe(true);
    expect(next).toContain('RÉSUMÉ : le format des heures est corrigé.');
    expect(next).toContain('Et ensuite ?');
    expect(next).not.toContain('Premier message.');
    expect(next.startsWith(frozenPrompt(now))).toBe(true);
  });

  it('keeps the last two turns as they were frozen when they weigh little', async () => {
    const { id, engine, say, entries } = await rig();
    await say('Premier message.');
    await say('Deuxième message.');
    await say('Troisième message.');
    await say('Quatrième message.');
    await say('Cinquième message.');
    await say('Sixième message.');
    await say('Septième message.');
    await say('Huitième message.');
    // Turns many: the last two together weigh under a third of the conversation.
    const result = await engine.compact(id, () => undefined);
    expect(result.keptTurns).toBe(2);
    const prompt = frozenPrompt(await entries());
    expect(prompt).toContain('Huitième message.');
    expect(prompt).toContain('Septième message.');
    expect(prompt).not.toContain('Sixième message.');
    // The rebase says where the turns kept begin: the page's checkpoint sits there.
    const now = await entries();
    const seventh = now.find((entry) => entry.kind === 'user' && entry.text === 'Septième message.')!;
    expect(now.at(-1)).toMatchObject({ kind: 'rebase', keptFrom: seventh.id });
  });

  it('a summary cut is refused: nothing changes', async () => {
    const { id, engine, say, entries } = await rig({ truncate: true });
    await say('Premier message.');
    await say('Deuxième message.');
    await say('Troisième message.');
    const before = await entries();
    await expect(engine.compact(id, () => undefined)).rejects.toBeInstanceOf(CompactionError);
    expect((await entries()).length).toBe(before.length);
  });

  it('an empty summary is refused, and a conversation too short for it to be worth it is left as it is', async () => {
    const empty = await rig({ summary: '   ' });
    await empty.say('Premier message.');
    await empty.say('Deuxième message.');
    await empty.say('Troisième message.');
    await expect(empty.engine.compact(empty.id, () => undefined)).rejects.toThrow(/empty/i);

    const short = await rig();
    await short.say('Bonjour');
    await expect(short.engine.compact(short.id, () => undefined)).rejects.toThrow(/worth/i);
  });

  it('after the rebase, the memory of the old prompt is let go, and the mode is told again', async () => {
    const { id, engine, kv, store, say, prompts } = await rig({ mode: 'plume' });
    await say('Premier message.');
    await say('Deuxième message.');
    await say('Troisième message.');
    const meta = (await store.get(id))!;
    await engine.compact(id, () => undefined);
    expect(await kv.manifest(`${id}_${meta.branchId}`)).toBeNull();
    await say('Et ensuite ?');
    expect(prompts.at(-1)).toMatch(/Plume/);
  });

  it('says when the context is nearly full — from 90 % — with what compacting would take', async () => {
    const { id, engine, store, say } = await rig();
    await say('Premier message.');
    await say('Deuxième message.');
    expect(await engine.contextOf(id)).toBeNull();
    const used = Math.ceil(frozenPrompt(await (async () => (await openJournal(store.dir, id, (await store.get(id))!.branchId)).entries())()).length / 4);
    await store.update(id, { contextCap: Math.floor(used / 0.95) });
    const full = await engine.contextOf(id);
    expect(full).toMatchObject({ kind: 'context-full', window: Math.floor(used / 0.95) });
    expect(full!.compactSeconds).toBeGreaterThan(0);
  });

  it('counts the context as the engine counted it after the last answer, as the gauge does — not an estimate', async () => {
    // The gauge shows the engine's count; an estimate (three characters to a token) said 92 % beside a gauge at 69 %.
    const { id, engine, store, say, prompts } = await rig();
    await say('Premier message.');
    await say('Deuxième message.');
    const counted = fakeTokenize(prompts.at(-1)!).length + fakeTokenize(LONG).length;
    // At 85 % of what the engine holds, nothing to say — though the estimate would be past the window.
    await store.update(id, { contextCap: Math.floor(counted / 0.85) });
    expect(await engine.contextOf(id)).toBeNull();
    await store.update(id, { contextCap: Math.floor(counted / 0.95) });
    expect(await engine.contextOf(id)).toMatchObject({ kind: 'context-full', used: counted });
  });

  it('compacts a conversation the engine holds at 90 % — an estimate of the whole found no room for the summary', async () => {
    const { id, engine, store, say, prompts } = await rig();
    await say('Premier message.');
    await say('Deuxième message.');
    await say('Troisième message.');
    const counted = fakeTokenize(prompts.at(-1)!).length + fakeTokenize(LONG).length;
    await store.update(id, { contextCap: Math.floor(counted / 0.9) });
    await expect(engine.compact(id, () => undefined)).resolves.toMatchObject({ summary: 'RÉSUMÉ : le format des heures est corrigé.' });
  });

  it('a memory to read again says what compacting first would take', async () => {
    const { id, engine, store, say } = await rig();
    await say('Premier message.');
    await say('Deuxième message.');
    const other = await store.create({ kind: 'code', engineId: 'builtin', modelId: 'gemma', mode: 'plume' });
    await engine.turn(other.id, { text: 'Ailleurs.' }, () => undefined);
    await engine.release(id);
    const announcement = await engine.open(id);
    expect(announcement).toMatchObject({ kind: 'reread' });
    expect(announcement?.kind === 'reread' && announcement.compactSeconds).toBeGreaterThan(announcement?.kind === 'reread' ? announcement.seconds : 0);
  });

  it('« Restaurer »: the conversation goes on from before the rebase, on a branch — the early turns read again', async () => {
    const { id, engine, store, say, prompts } = await rig();
    await say('Premier message.');
    await say('Deuxième message.');
    await say('Troisième message.');
    const compacted = (await store.get(id))!.branchId;
    await engine.compact(id, () => undefined);
    const restored = await engine.uncompact(id);
    expect(restored).not.toBe(compacted);
    expect((await store.get(id))!.branchId).toBe(restored);
    await say('Et ensuite ?');
    expect(prompts.at(-1)).toContain('Premier message.');
    expect(prompts.at(-1)).not.toContain('[conversation summary]');
  });
});

describe('a compaction is never undone in silence, nor its cost hidden (review of phase 7)', { timeout: 30_000 }, () => {
  const WORDS = ['Premier', 'Deuxième', 'Troisième', 'Quatrième', 'Cinquième', 'Sixième', 'Septième', 'Huitième'];

  it('« Restaurer » after a turn that followed it: the branch carries no memory of the compacted prompt — its re-reading is said', async () => {
    const { id, engine, say } = await rig();
    for (const word of WORDS.slice(0, 4)) await say(`${word} message.`);
    await engine.compact(id, () => undefined);
    await say('Et ensuite ?');
    await engine.uncompact(id);
    expect(await engine.open(id)).toMatchObject({ kind: 'reread' });
  });

  it('going back before a message it folded: said as a re-reading of what is kept, never as memory kept', async () => {
    const { id, engine, say } = await rig();
    for (const word of WORDS.slice(0, 4)) await say(`${word} message.`);
    await engine.compact(id, () => undefined);
    await say('Et ensuite ?');
    expect(await engine.rewindMemory(id, { userIndex: 2, text: 'Troisième message.' })).toMatchObject({ kind: 'reread' });
  });

  it('going back among the turns it kept counts the new branch, not the copied answers’ count from before it (review of the gate)', async () => {
    // The kept answers are copied after a new rebase: what the engine held when each was written, the whole
    // conversation still in it, is not what the branch holds — the banner said full, a message was refused.
    const { id, engine, store, say, entries } = await rig();
    for (const word of WORDS) await say(`${word} message.`);
    expect((await engine.compact(id, () => undefined)).keptTurns).toBe(2);
    await engine.rewindTo(id, { userIndex: 7, text: 'Huitième message.' }, 'conversation');
    const held = fakeTokenize(frozenPrompt(await entries())).length;
    await store.update(id, { contextCap: held + 1024 + 1500 });
    expect(await engine.contextOf(id)).toBeNull();
    const result = await engine.turn(id, { text: 'Encore ?' }, () => undefined);
    expect(result.stopped).toBeUndefined();
  });

  it('asking again an answer it kept: the compaction stays — the summary, the turns kept, the new answer', async () => {
    const { id, engine, say, entries, prompts } = await rig();
    for (const word of WORDS) await say(`${word} message.`);
    expect((await engine.compact(id, () => undefined)).keptTurns).toBe(2);
    const last = (await entries()).findLast((entry) => entry.kind === 'user')!;
    await engine.turn(id, { forkAfter: last.id }, () => undefined);
    const sent = prompts.at(-1)!;
    expect(sent).toContain('RÉSUMÉ : le format des heures est corrigé.');
    expect(sent).toContain('Septième message.');
    expect(sent).toContain('Huitième message.');
    expect(sent).not.toContain('Premier message.');
  });

  it('changing a message it kept: the compaction stays, the message changed after the summary', async () => {
    const { id, engine, say, entries, prompts } = await rig();
    for (const word of WORDS) await say(`${word} message.`);
    await engine.compact(id, () => undefined);
    const now = await entries();
    const seventh = now.findIndex((entry) => entry.kind === 'user' && entry.text === 'Septième message.');
    await engine.turn(id, { forkAfter: now[seventh - 1]!.id, text: 'Septième, corrigé.' }, () => undefined);
    const sent = prompts.at(-1)!;
    expect(sent).toContain('RÉSUMÉ : le format des heures est corrigé.');
    expect(sent).toContain('Septième, corrigé.');
    expect(sent).not.toContain('Huitième message.');
    expect(sent).not.toContain('Premier message.');
  });
});

