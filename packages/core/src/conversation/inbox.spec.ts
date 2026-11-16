/**
 * « À traiter » (task 8.4): everything that waits for the person, across the
 * conversations — an approval, a sub-agent's request (named), a question, a
 * pull request whose CI fails, a cost to accept (a turn the engine cut: going
 * on reads the conversation again) — and, apart, the replies finished since
 * the window last showed their conversation. An archived conversation waits
 * for nothing.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LlamaCppHttpClient } from '../backend/llamacpp/http-client.js';
import { familyLayer } from '../families/index.js';
import { openJournal } from '../journal/journal.js';
import type { NewJournalEntry } from '../journal/types.js';
import { KvStore, type LiveConfig } from '../kv/kv-store.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';
import { ConversationEngine } from './engine.js';
import { readInbox } from './inbox.js';
import { ConversationStore } from './store.js';

const LIVE: LiveConfig = { modelFingerprint: 'fp-gemma', nCtx: 8192, cacheTypeK: 'f16', cacheTypeV: 'f16' };

let servers: FakeLlamaServer[] = [];
let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
  servers = [];
  dirs = [];
});

async function rig() {
  const dir = await mkdtemp(join(tmpdir(), 'bp-inbox-'));
  dirs.push(dir);
  const server = await startFakeLlamaServer({ slotDir: join(dir, 'kv') });
  servers.push(server);
  const client = new LlamaCppHttpClient(server.url);
  const store = new ConversationStore(join(dir, 'conversations'));
  const conversations = new ConversationEngine({
    store,
    kv: new KvStore(join(dir, 'kv')),
    engine: async () => ({ client, family: familyLayer('gemma'), live: LIVE, modelPath: 'gemma.gguf', kvBytesPerToken: 100, generation: 1 }),
    prompt: () => ({ kind: 'code', tools: [], perimeter: [], replyLanguage: 'French' }),
  });
  /** A conversation whose journal holds these entries, after its system turn and a message. */
  const conversation = async (title: string, entries: NewJournalEntry[]) => {
    const meta = await store.create({ kind: 'code', engineId: 'builtin', modelId: 'gemma', mode: 'repetition' });
    await store.update(meta.id, { title });
    const journal = await openJournal(store.dir, meta.id);
    await journal.append({ kind: 'system', rendered: '<|turn>system\nYou are bonaparte.<turn|>\n' });
    await journal.append({ kind: 'user', text: 'Bonjour', rendered: '<|turn>user\nBonjour<turn|>\n' });
    for (const entry of entries) await journal.append(entry);
    return meta;
  };
  return { store, conversations, conversation };
}

const call = (id: string, name: string, input: unknown, reason: 'approval' | 'external' | 'queued' = 'approval', agentId?: string) => ({
  toolCallId: id,
  name,
  input,
  reason,
  ...(agentId ? { agentId } : {}),
});

describe('readInbox', () => {
  it('gathers what waits for the person, each with its conversation — never an archived one', async () => {
    const { store, conversations, conversation } = await rig();
    const edit = await conversation('Corriger les heures décimales', [
      { kind: 'assistant', raw: 'call', rendered: '' },
      { kind: 'pending', calls: [call('c1', 'edit_file', { path: 'src/format.ts' })], ticket: 't', rendered: '' },
    ]);
    const archived = await conversation('Vieille affaire', [
      { kind: 'assistant', raw: 'call', rendered: '' },
      { kind: 'pending', calls: [call('c9', 'edit_file', { path: 'x.ts' })], ticket: 't', rendered: '' },
    ]);
    await store.mark(archived.id, { archivedAt: new Date().toISOString() });
    const inbox = await readInbox({ store, conversations });
    expect(inbox.approvals).toEqual([
      expect.objectContaining({ conversationId: edit.id, title: 'Corriger les heures décimales', call: { id: 'c1', name: 'edit_file', input: { path: 'src/format.ts' } } }),
    ]);
    expect(inbox.subagentRequests).toEqual([]);
    expect(inbox.questions).toEqual([]);
  });

  it("a sub-agent's request names it; a question says what is asked", async () => {
    const { store, conversations, conversation } = await rig();
    const ci = await conversation('Pourquoi la CI est lente ?', [
      { kind: 'assistant', raw: 'call', rendered: '' },
      {
        kind: 'pending',
        calls: [call('s1', 'run_command', { program: 'pnpm', args: ['test'] }, 'approval', 'agent-1')],
        subagents: [{ toolCallId: 'r1', agentId: 'agent-1', name: 'run_subagent', input: { name: 'Mesureur', mission: 'Chronométrer.' } }],
        ticket: 't',
        rendered: '',
      },
    ]);
    const zod = await conversation('Migrer le parseur vers zod', [
      { kind: 'assistant', raw: 'call', rendered: '' },
      { kind: 'pending', calls: [call('q1', 'ask_user', { question: 'Une date vide : je la garde vide ?' }, 'external')], ticket: 't', rendered: '' },
    ]);
    const inbox = await readInbox({ store, conversations });
    expect(inbox.approvals).toEqual([]);
    expect(inbox.subagentRequests).toEqual([
      expect.objectContaining({ conversationId: ci.id, agent: 'Mesureur', call: expect.objectContaining({ id: 's1', name: 'run_command' }) }),
    ]);
    expect(inbox.questions).toEqual([
      expect.objectContaining({ conversationId: zod.id, question: 'Une date vide : je la garde vide ?', call: expect.objectContaining({ id: 'q1' }) }),
    ]);
  });

  it('a question asked as a list of questions says its words: the first, or each one (check of aparté 1.12)', async () => {
    const { store, conversations, conversation } = await rig();
    const one = await conversation('Une question', [
      { kind: 'assistant', raw: 'call', rendered: '' },
      {
        kind: 'pending',
        calls: [call('q1', 'ask_user', { questions: [{ question: 'Une date vide : que fais-je ?', header: 'Date', options: [{ title: 'La garder vide' }] }] }, 'external')],
        ticket: 't',
        rendered: '',
      },
    ]);
    const two = await conversation('Deux questions', [
      { kind: 'assistant', raw: 'call', rendered: '' },
      {
        kind: 'pending',
        calls: [call('q2', 'ask_user', { questions: [{ question: 'Quel format ?' }, { question: 'Quel fuseau ?' }] }, 'external')],
        ticket: 't',
        rendered: '',
      },
    ]);
    const inbox = await readInbox({ store, conversations });
    expect(inbox.questions.find((item) => item.conversationId === one.id)?.question).toBe('Une date vide : que fais-je ?');
    expect(inbox.questions.find((item) => item.conversationId === two.id)?.question).toBe('Quel format ? · Quel fuseau ?');
  });

  it('a turn the engine cut is a cost to accept: what reading the conversation again costs', async () => {
    const { store, conversations, conversation } = await rig();
    const cut = await conversation('Tests du formateur', [{ kind: 'assistant', raw: 'Je relis', stopped: 'engine', rendered: '<|turn>model\nJe relis' }]);
    await conversation('Une conversation finie', [{ kind: 'assistant', raw: 'Fait.', rendered: '<|turn>model\nFait.<turn|>\n' }]);
    const inbox = await readInbox({ store, conversations });
    expect(inbox.costs).toEqual([expect.objectContaining({ conversationId: cut.id, title: 'Tests du formateur' })]);
    expect(inbox.costs[0]!.tokens).toBeGreaterThan(0);
    expect(inbox.costs[0]!.seconds).toBeGreaterThan(0);
  });

  it('a reply finished after the window last showed its conversation is unread; one it showed is not', async () => {
    const { store, conversations, conversation } = await rig();
    const finished = await conversation('Pourquoi la CI est lente ?', []);
    await store.mark(finished.id, { seenAt: new Date(Date.now() - 60_000).toISOString() });
    await (await openJournal(store.dir, finished.id)).append({ kind: 'assistant', raw: 'La synthèse est prête.', rendered: '' });
    const read = await conversation('Déjà lue', [{ kind: 'assistant', raw: 'Fait.', rendered: '' }]);
    await store.mark(read.id, { seenAt: new Date(Date.now() + 1_000).toISOString() });
    const inbox = await readInbox({ store, conversations });
    expect(inbox.unread).toEqual([expect.objectContaining({ conversationId: finished.id, said: 'La synthèse est prête.' })]);
  });

  it('one conversation whose journal cannot be read hides only itself: the others still wait (review of phase 8)', async () => {
    const { store, conversations, conversation } = await rig();
    const broken = await conversation('Abîmée', [{ kind: 'assistant', raw: 'Fait.', rendered: '' }]);
    const waiting = await conversation('Change la note', [
      { kind: 'pending', calls: [call('c1', 'edit_file', { path: 'notes.txt' })], ticket: 't', rendered: '' },
    ]);
    const file = join(store.dir, broken.id, 'main.jsonl');
    const lines = (await readFile(file, 'utf8')).split('\n');
    lines.splice(1, 0, '{ this line is not JSON');
    await writeFile(file, lines.join('\n'));
    const inbox = await readInbox({ store, conversations });
    expect(inbox.approvals.map((item) => item.conversationId)).toEqual([waiting.id]);
    // « Moteur et mémoire » lists the others too.
    expect((await conversations.memory()).map((row) => row.id)).toEqual([waiting.id]);
  });

  it('a pull request whose CI fails, as GitHub says it', async () => {
    const { store, conversations, conversation } = await rig();
    const pr = await conversation('Migrer le parseur vers zod', []);
    await store.update(pr.id, { worktree: '/w', branch: 'bonaparte/zod' });
    const passing = await conversation('Autre branche', []);
    await store.update(passing.id, { worktree: '/v', branch: 'bonaparte/autre' });
    const inbox = await readInbox({
      store,
      conversations,
      prOf: async (id) =>
        id === pr.id ? { number: 42, url: 'https://example.test/pr/42', ci: 'failure' } : { number: 7, url: 'https://example.test/pr/7', ci: 'success' },
    });
    expect(inbox.ciFailures).toEqual([expect.objectContaining({ conversationId: pr.id, pr: { number: 42, url: 'https://example.test/pr/42' } })]);
  });
});

describe('« Fini, pas encore lu » in the sidebar, and « Relire et continuer »', () => {
  it('the status says unread until the window shows the conversation again', async () => {
    const { store, conversations, conversation } = await rig();
    const meta = await conversation('Pourquoi la CI est lente ?', []);
    await store.mark(meta.id, { seenAt: new Date(Date.now() - 60_000).toISOString() });
    await (await openJournal(store.dir, meta.id)).append({ kind: 'assistant', raw: 'La synthèse est prête.', rendered: '' });
    expect(await conversations.status(meta.id)).toMatchObject({ unread: true });
    await conversations.markSeen(meta.id);
    expect(await conversations.status(meta.id)).toMatchObject({ unread: false });
    expect((await readInbox({ store, conversations })).unread).toEqual([]);
  });

  it('what an unread reply says leaves its reasoning out, in its own family — Qwen thinks between <think> tags', async () => {
    const { store, conversations } = await rig();
    const meta = await store.create({ kind: 'code', engineId: 'builtin', modelId: 'qwen.gguf', mode: 'repetition' });
    await store.update(meta.id, { title: 'Pourquoi la CI est lente ?' });
    const journal = await openJournal(store.dir, meta.id);
    await journal.append({ kind: 'system', modelId: 'qwen.gguf', family: 'qwen', rendered: '<|im_start|>system\nYou are bonaparte.<|im_end|>\n' });
    await journal.append({ kind: 'user', text: 'Pourquoi ?', rendered: '<|im_start|>user\nPourquoi ?<|im_end|>\n' });
    await store.mark(meta.id, { seenAt: new Date(Date.now() - 60_000).toISOString() });
    await journal.append({ kind: 'assistant', raw: '<think>\nJe compte les runs un par un.\n</think>\n\nLa synthèse est prête.', rendered: '' });
    expect((await readInbox({ store, conversations })).unread).toEqual([expect.objectContaining({ conversationId: meta.id, said: 'La synthèse est prête.' })]);
  });

  it('a turn cut on a model the engine no longer runs: no cost to accept, and « Relire et continuer » reads nothing — its next message changes model, said then', async () => {
    const { store, conversations } = await rig();
    const meta = await store.create({ kind: 'code', engineId: 'builtin', modelId: 'qwen.gguf', mode: 'repetition' });
    const journal = await openJournal(store.dir, meta.id);
    await journal.append({ kind: 'system', modelId: 'qwen.gguf', family: 'qwen', rendered: '<|im_start|>system\nYou are bonaparte.<|im_end|>\n' });
    await journal.append({ kind: 'user', text: 'Compte', rendered: '<|im_start|>user\nCompte<|im_end|>\n' });
    await journal.append({ kind: 'assistant', raw: 'un deux', stopped: 'engine', rendered: '<|im_start|>assistant\nun deux' });
    expect((await readInbox({ store, conversations })).costs).toEqual([]);
    await conversations.readAgain(meta.id);
    expect(await conversations.status(meta.id)).not.toMatchObject({ memory: 'engine' });
  });

  it('« Relire et continuer » reads the conversation again now: its cost is no longer to accept, its memory is in the engine', async () => {
    const { store, conversations, conversation } = await rig();
    const cut = await conversation('Tests du formateur', [{ kind: 'assistant', raw: 'Je relis', stopped: 'engine', rendered: '<|turn>model\nJe relis' }]);
    expect((await readInbox({ store, conversations })).costs).toHaveLength(1);
    await conversations.readAgain(cut.id);
    expect((await readInbox({ store, conversations })).costs).toEqual([]);
    expect(await conversations.status(cut.id)).toMatchObject({ memory: 'engine' });
  });
});
