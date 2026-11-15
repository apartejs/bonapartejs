/**
 * The branches of a conversation (task 7.2, « Brancher »): each one listed
 * with where it parts from the others and what it says there; one made the
 * branch shown — the window's document of the one left kept, the other's
 * given back (or read again from the journal); and the answer the person
 * picks among siblings followed, so that the next message goes on that one.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LlamaCppHttpClient } from '../backend/llamacpp/http-client.js';
import { familyLayer } from '../families/index.js';
import { openJournal } from '../journal/journal.js';
import { KvStore, type LiveConfig } from '../kv/kv-store.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';
import { createBranches } from './branches.js';
import { ConversationEngine } from './engine.js';
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

async function rig() {
  const dir = await mkdtemp(join(tmpdir(), 'bp-branches-'));
  dirs.push(dir);
  const kvDir = join(dir, 'kv-slots');
  let answer = 0;
  const server = await startFakeLlamaServer({ slotDir: kvDir, responder: () => `Réponse ${(answer += 1)}.` });
  servers.push(server);
  const client = new LlamaCppHttpClient(server.url);
  const store = new ConversationStore(join(dir, 'conversations'));
  const engine = new ConversationEngine({
    store,
    kv: new KvStore(kvDir),
    engine: async () => ({ client, family: gemma, live: LIVE, modelPath: 'gemma.gguf', kvBytesPerToken: 100, generation: 1 }),
    prompt: () => ({ kind: 'code', tools: [], perimeter: [], replyLanguage: 'French' }),
  });
  const branches = createBranches({ engine, store, family: () => gemma });
  const { id } = await store.create({ kind: 'code', engineId: 'builtin', modelId: 'gemma', mode: 'plume' });
  /** A turn as the handler gives it: a message, a message changed (`forkAfter`), or an answer asked again (no text). */
  const say = (text: string | null, messageId: string, forkAfter?: string) =>
    engine.turn(id, { ...(text !== null ? { text } : {}), messageId, ...(forkAfter ? { forkAfter } : {}) }, () => undefined);
  const entries = async () => (await openJournal(store.dir, id, (await store.get(id))!.branchId)).entries();
  const branchId = async () => (await store.get(id))!.branchId;
  return { id, store, engine, branches, say, entries, branchId };
}

describe('the branches of a conversation', () => {
  it('lists each branch: where it parts from its parent, what it says there, which one is shown', async () => {
    const { id, branches, say, entries, branchId } = await rig();
    await say('Premier message.', 'm1');
    await say('Deuxième message.', 'm2');
    const main = await branchId();
    // A message changed: a branch that parts at the second message.
    const read = await entries();
    const second = read.find((entry) => entry.kind === 'user' && entry.text === 'Deuxième message.')!;
    const before = read[read.indexOf(second) - 1]!;
    await say('Deuxième, autrement.', 'm3', before.id);
    const edited = await branchId();

    const list = await branches.list(id);
    expect(list).toHaveLength(2);
    expect(list.find((branch) => branch.branchId === main)).toMatchObject({ active: false, userIndex: 0, label: 'Premier message.' });
    expect(list.find((branch) => branch.branchId === edited)).toMatchObject({ active: true, userIndex: 1, label: 'Deuxième, autrement.' });
  });

  it('shows another branch: the document of the one left is kept, the other one’s given back', async () => {
    const { id, store, branches, say, entries, branchId } = await rig();
    await say('Premier message.', 'm1');
    const main = await branchId();
    const read = await entries();
    const first = read.find((entry) => entry.kind === 'user')!;
    const before = read[read.indexOf(first) - 1]!;
    await say('Autre départ.', 'm2', before.id);
    const other = await branchId();
    await store.saveDocument(id, { id, messages: ['the other branch, as shown'] });

    await branches.switchTo(id, main);
    expect(await branchId()).toBe(main);
    // The page shows the main branch (read again from the journal), and keeps its document.
    await store.saveDocument(id, { id, messages: ['the main branch, as shown'] });
    await branches.switchTo(id, other);
    expect(await store.loadDocument(id)).toEqual({ id, messages: ['the other branch, as shown'] });
    await branches.switchTo(id, main);
    expect(await store.loadDocument(id)).toEqual({ id, messages: ['the main branch, as shown'] });
  });

  it('a branch never shown has no document: it is read again from the journal', async () => {
    const { id, store, branches, say, entries, branchId } = await rig();
    await say('Premier message.', 'm1');
    const main = await branchId();
    const read = await entries();
    const first = read.find((entry) => entry.kind === 'user')!;
    const before = read[read.indexOf(first) - 1]!;
    await say('Autre départ.', 'm2', before.id);
    await store.saveDocument(id, { id, messages: ['the other branch, as shown'] });
    // The main branch was left by a message changed: the page had not kept its document apart.
    await branches.switchTo(id, main);
    expect(await store.loadDocument(id)).toBeNull();
  });

  it('follows the answer the person picks among siblings: the branch whose turns they are becomes the one shown', async () => {
    const { id, branches, say, entries, branchId } = await rig();
    await say('Premier message.', 'm1');
    const main = await branchId();
    const user = (await entries()).find((entry) => entry.kind === 'user')!;
    // « Réessayer »: a sibling answer, on a branch after the message.
    await say(null, 'm2', user.id);
    expect(await branchId()).not.toBe(main);
    expect(await branches.follow(id, ['m1'])).toBe(main);
    expect(await branchId()).toBe(main);
    expect(await branches.follow(id, ['unknown'])).toBeNull();
    expect(await branchId()).toBe(main);
  });
});
