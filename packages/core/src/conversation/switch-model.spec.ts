/**
 * Changing model mid-conversation (task 7.4). A branch knows the model and
 * family its prompt was frozen for. A turn on another model opens a new
 * branch with an explicit change of model — an `engine` entry, the system
 * prompt frozen again and the conversation rendered again by the new family
 * —, and the branch it leaves keeps its memory for the old model. Opening
 * such a conversation says the re-reading first.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LlamaCppHttpClient } from '../backend/llamacpp/http-client.js';
import { familyLayer } from '../families/index.js';
import { openJournal } from '../journal/journal.js';
import type { JournalEntry } from '../journal/types.js';
import { KvStore, type LiveConfig } from '../kv/kv-store.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';
import { planCompaction } from './compact.js';
import { estimateTokens, ConversationEngine, NOT_RUN_UNANSWERED, type EngineView } from './engine.js';
import { ConversationStore } from './store.js';

const gemma = familyLayer('gemma');
const qwen = familyLayer('qwen');
const LIVE_GEMMA: LiveConfig = { modelFingerprint: 'fp-gemma', nCtx: 32_768, cacheTypeK: 'f16', cacheTypeV: 'f16' };
const LIVE_QWEN: LiveConfig = { modelFingerprint: 'fp-qwen', nCtx: 32_768, cacheTypeK: 'f16', cacheTypeV: 'f16' };

let servers: FakeLlamaServer[] = [];
let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  servers = [];
  dirs = [];
});

async function rig() {
  const dir = await mkdtemp(join(tmpdir(), 'bp-switch-'));
  dirs.push(dir);
  const kvDir = join(dir, 'kv-slots');
  const prompts: string[] = [];
  const server = await startFakeLlamaServer({ slotDir: kvDir, responder: () => 'Bien reçu.', onCompletion: (body) => prompts.push(String(body['prompt'])) });
  servers.push(server);
  const client = new LlamaCppHttpClient(server.url);
  const views: Record<'gemma' | 'qwen' | 'gemmaSmall', EngineView> = {
    gemma: { client, family: gemma, live: LIVE_GEMMA, modelPath: 'gemma.gguf', kvBytesPerToken: 100, generation: 1, slidingWindow: 1024 },
    gemmaSmall: { client, family: gemma, live: { ...LIVE_GEMMA, modelFingerprint: 'fp-gemma-small' }, modelPath: 'gemma-small.gguf', kvBytesPerToken: 100, generation: 1 },
    qwen: { client, family: qwen, live: LIVE_QWEN, modelPath: 'qwen.gguf', kvBytesPerToken: 100, generation: 1 },
  };
  let loaded: EngineView = views.gemma;
  const store = new ConversationStore(join(dir, 'conversations'));
  const kv = new KvStore(kvDir);
  const engine = new ConversationEngine({
    store,
    kv,
    engine: async () => loaded,
    prompt: () => ({ kind: 'code', tools: [], perimeter: [], replyLanguage: 'French' }),
  });
  const { id } = await store.create({ kind: 'code', engineId: 'builtin', modelId: 'gemma.gguf', mode: 'plume' });
  const say = (text: string) => engine.turn(id, { text }, () => undefined);
  const branch = async (branchId?: string) =>
    (await openJournal(store.dir, id, branchId ?? (await store.get(id))!.branchId)).entries();
  const load = (name: keyof typeof views) => {
    loaded = views[name];
  };
  return { id, engine, kv, store, prompts, say, branch, load };
}

describe('a branch knows the model it runs on', { timeout: 30_000 }, () => {
  it('its first system turn says the model and the family its prompt was frozen for', async () => {
    const { say, branch } = await rig();
    await say('Bonjour');
    expect((await branch())[0]).toMatchObject({ kind: 'system', modelId: 'gemma.gguf', family: 'gemma' });
  });
});

describe('a turn on another model', { timeout: 30_000 }, () => {
  it('opens a new branch with a change of model: the conversation rendered again by the new family', async () => {
    const { id, store, prompts, say, branch, load } = await rig();
    await say('Bonjour');
    load('qwen');
    await say('Et maintenant ?');

    const meta = (await store.get(id))!;
    expect(meta.branchId).not.toBe('main');
    expect(meta.modelId).toBe('qwen.gguf');
    const entries = await branch();
    const change = entries.find((entry): entry is Extract<JournalEntry, { kind: 'engine' }> => entry.kind === 'engine');
    expect(change).toMatchObject({ engineId: 'builtin', modelId: 'qwen.gguf', family: 'qwen' });
    expect(change!.stable!.startsWith('<|im_start|>system')).toBe(true);

    const sent = prompts.at(-1)!;
    expect(sent.startsWith('<|im_start|>system')).toBe(true);
    expect(sent).toContain(qwen.renderUser('Bonjour') + qwen.renderAnswer({ text: 'Bien reçu.', calls: [] }));
    expect(sent).toContain(qwen.renderUser('Et maintenant ?'));
    expect(sent).not.toContain('<|turn>');

    // The branch it left is as it was: the old model's conversation, its last answer last.
    const main = await branch('main');
    expect(main.some((entry) => entry.kind === 'engine')).toBe(false);
    expect(main.at(-1)).toMatchObject({ kind: 'assistant', raw: 'Bien reçu.' });
  });

  it('the mode is told again after it: the frozen prompt names none', async () => {
    const { say, branch, load } = await rig();
    await say('Bonjour');
    load('qwen');
    await say('Et maintenant ?');
    const entries = await branch();
    const at = entries.findIndex((entry) => entry.kind === 'engine');
    expect(at).toBeGreaterThan(0);
    const after = entries.slice(at + 1);
    expect(after.some((entry) => entry.kind === 'delta' && entry.delta.kind === 'mode' && entry.delta.mode === 'plume')).toBe(true);
  });

  it('the branch it leaves keeps its memory, for the old model', async () => {
    const { id, kv, say, load } = await rig();
    await say('Bonjour');
    load('qwen');
    await say('Et maintenant ?');
    expect((await kv.manifest(`${id}_main`))?.modelFingerprint).toBe('fp-gemma');
  });

  it('the next turn on that model only appends: no second change', async () => {
    const { prompts, say, branch, load } = await rig();
    await say('Bonjour');
    load('qwen');
    await say('Et maintenant ?');
    const before = prompts.at(-1)!;
    await say('Encore');
    expect((await branch()).filter((entry) => entry.kind === 'engine')).toHaveLength(1);
    expect(prompts.at(-1)!.startsWith(before)).toBe(true);
  });

  it('a model of the same family changes too: the memory was the other model’s', async () => {
    const { say, branch, load } = await rig();
    await say('Bonjour');
    load('gemmaSmall');
    await say('Et maintenant ?');
    expect((await branch()).find((entry) => entry.kind === 'engine')).toMatchObject({ modelId: 'gemma-small.gguf', family: 'gemma' });
  });

  it('a journal older than the record: the same family goes on as it is, another family changes', async () => {
    const { id, store, say, branch, load } = await rig();
    // As the engine wrote it before task 7.4: no model, no family on the system turn.
    const journal = await openJournal(store.dir, id);
    await journal.append({ kind: 'system', rendered: gemma.renderSystem('OLD') });
    await journal.append({ kind: 'user', text: 'Bonjour', rendered: gemma.renderUser('Bonjour') });
    await journal.append({ kind: 'assistant', raw: 'Salut.', rendered: `${gemma.beginAssistant({ thinking: true })}Salut.<turn|>\n` });
    load('gemmaSmall');
    await say('Suite');
    expect((await branch()).some((entry) => entry.kind === 'engine')).toBe(false);
    load('qwen');
    await say('Et en Qwen ?');
    expect((await branch()).find((entry) => entry.kind === 'engine')).toMatchObject({ family: 'qwen' });
  });
});

describe('a call that waited, on another model', { timeout: 30_000 }, () => {
  it('given up for a new message: answered as not run, its turn closed before the message (review of phase 7)', async () => {
    const { id, store, prompts, say, load } = await rig();
    await say('Bonjour');
    const journal = await openJournal(store.dir, id, (await store.get(id))!.branchId);
    await journal.append({ kind: 'user', text: 'Écris a', rendered: gemma.renderUser('Écris a') });
    const raw = '<|tool_call>call:write_file{path:<|"|>a<|"|>}<tool_call|>';
    await journal.append({ kind: 'assistant', raw, rendered: gemma.beginAssistant({ thinking: true }) + raw + gemma.endAssistant(raw) });
    await journal.append({ kind: 'pending', calls: [{ toolCallId: 'c1', name: 'write_file', input: { path: 'a' }, reason: 'approval' }], ticket: 't', rendered: '' });
    load('qwen');
    await say('Laisse tomber.');
    const sent = prompts.at(-1)!;
    expect(sent).toContain(NOT_RUN_UNANSWERED);
    expect(sent.indexOf(NOT_RUN_UNANSWERED)).toBeLessThan(sent.indexOf('Laisse tomber.'));
  });
});

describe('opening a conversation of another model', { timeout: 30_000 }, () => {
  it('says the re-reading first, as for another model — with no memory saved too', async () => {
    const { id, engine, say, load } = await rig();
    await say('Bonjour');
    load('qwen');
    expect(await engine.open(id)).toMatchObject({ kind: 'reread', reason: 'other-model' });
  });

  it('on its own model, a conversation is restored as before', async () => {
    const { id, engine, say, load } = await rig();
    await say('Bonjour');
    load('qwen');
    await say('Et maintenant ?');
    load('gemma');
    // Its branch is the Qwen one now: Gemma would read it again.
    expect(await engine.open(id)).toMatchObject({ kind: 'reread', reason: 'other-model' });
  });
});

describe('what changing model would read', { timeout: 30_000 }, () => {
  it('the conversation rendered again for the new model; nothing for a conversation with no message', async () => {
    const { id, engine, store, say } = await rig();
    const target = { family: qwen, modelPath: 'qwen.gguf' };
    expect(await engine.rereadOn(id, target)).toBe(0);
    await say('Bonjour');
    const tokens = await engine.rereadOn(id, target);
    expect(tokens).toBeGreaterThan(estimateTokens(qwen.renderUser('Bonjour')));
    const empty = await store.create({ kind: 'code', engineId: 'builtin', modelId: '', mode: 'plume' });
    expect(await engine.rereadOn(empty.id, target)).toBe(0);
  });

  it('back on the model it was frozen for, with its memory saved: nothing to read', async () => {
    const { id, engine, say, load } = await rig();
    await say('Bonjour');
    load('qwen');
    await engine.flush();
    expect(await engine.rereadOn(id, { family: gemma, modelPath: 'gemma.gguf' })).toBe(0);
  });
});

describe('a copy on another model (« Brancher sur ce modèle »)', { timeout: 30_000 }, () => {
  it('a new conversation: the branch shown, its document, and a change of model at its head; the original untouched', async () => {
    const { id, engine, store, say, branch } = await rig();
    await say('Bonjour');
    await store.saveDocument(id, { id, messages: ['the window’s thread'] });
    await store.update(id, { worktree: 'C:/somewhere/.bonaparte/worktrees/x', worksIn: 'branch', branch: 'x' });
    const before = await branch();

    const copy = await engine.copy(id, { family: qwen, modelPath: 'qwen.gguf' });
    expect(copy.id).not.toBe(id);
    expect(copy).toMatchObject({ kind: 'code', mode: 'plume', modelId: 'qwen.gguf', branchId: 'main' });
    // A worktree belongs to one conversation: the copy works in the project's folder.
    expect(copy.worktree).toBeUndefined();
    expect(copy.branch).toBeUndefined();
    expect(await store.loadDocument(copy.id)).toEqual({ id: copy.id, messages: ['the window’s thread'] });
    const copied = (await openJournal(store.dir, copy.id)).entries();
    expect(copied.slice(0, before.length).map((entry) => entry.id)).toEqual(before.map((entry) => entry.id));
    expect(copied.at(-1)).toMatchObject({ kind: 'engine', modelId: 'qwen.gguf', family: 'qwen' });
    expect(await branch()).toEqual(before);
    expect((await store.get(id))!.modelId).toBe('gemma.gguf');
  });
});

describe('going back across a change of model', { timeout: 30_000 }, () => {
  it('before a message frozen for the old model: said as a re-reading for this one, never as memory kept', async () => {
    const { id, engine, say, load } = await rig();
    await say('Bonjour');
    load('qwen');
    await say('Et maintenant ?');
    expect(await engine.rewindMemory(id, { userIndex: 0, text: 'Bonjour' })).toMatchObject({ kind: 'reread', reason: 'other-model' });
    // After the change: the memory is this model's, as before.
    expect(await engine.rewindMemory(id, { userIndex: 1, text: 'Et maintenant ?' })).not.toMatchObject({ reason: 'other-model' });
  });
});

describe('compacting after a change of model', { timeout: 30_000 }, () => {
  it('folds what the change of model rendered, and keeps only turns written after it', () => {
    let next = 0;
    const entry = (body: object): JournalEntry => ({ id: `e${(next += 1)}`, at: new Date(next).toISOString(), ...body }) as JournalEntry;
    const long = 'x'.repeat(30_000);
    const entries = [
      entry({ kind: 'system', rendered: 'S' }),
      entry({ kind: 'user', text: 'u1', rendered: 'U1' }),
      entry({ kind: 'engine', engineId: 'builtin', modelId: 'qwen.gguf', family: 'qwen', rendered: long }),
      entry({ kind: 'user', text: 'u2', rendered: 'U2' }),
      entry({ kind: 'assistant', raw: 'a2', rendered: 'A2' }),
      entry({ kind: 'user', text: 'u3', rendered: 'U3' }),
      entry({ kind: 'assistant', raw: 'a3', rendered: 'A3' }),
      entry({ kind: 'user', text: 'u4', rendered: 'U4' }),
      entry({ kind: 'assistant', raw: 'a4', rendered: 'A4' }),
    ];
    const plan = planCompaction(entries, estimateTokens);
    expect(plan.compactedTokens).toBeGreaterThan(estimateTokens(long) - 64);
    expect(plan.kept.map((kept) => kept.id)).toEqual(entries.slice(5).map((kept) => kept.id));
  });
});
