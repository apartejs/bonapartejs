/**
 * Going back before a message (task 7.1, board « Revenir en arrière »): the
 * code and the conversation, the conversation only, or the code only. The
 * conversation goes back on a new branch that starts before the message —
 * what followed stays in the old one, with its memory; the files go back by
 * undoing every turn that wrote since, the latest first. What the model must
 * know of it is a note at its next turn. A command already run is not undone:
 * it is named. Going back can itself be undone.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LlamaCppHttpClient } from '../backend/llamacpp/http-client.js';
import { CheckpointStore } from '../checkpoints/store.js';
import { familyLayer } from '../families/index.js';
import { frozenPrompt, openJournal } from '../journal/journal.js';
import { KvStore, type LiveConfig } from '../kv/kv-store.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';
import { ConversationEngine } from './engine.js';
import { createRewind, RewindTargetError } from './rewind.js';
import { ConversationStore } from './store.js';

const LIVE: LiveConfig = { modelFingerprint: 'fp-gemma', nCtx: 8192, cacheTypeK: 'f16', cacheTypeV: 'f16' };
const gemma = familyLayer('gemma');
const Q = '<|"|>';
const RUN = `<|tool_call>call:run_command{program:${Q}pnpm${Q},args:[${Q}test${Q}]}<tool_call|>`;

let servers: FakeLlamaServer[] = [];
let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  servers = [];
  dirs = [];
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A conversation of three turns: the first and the third write files; the third also runs `pnpm test`. */
async function rig() {
  const dir = await mkdtemp(join(tmpdir(), 'bp-rewind-'));
  dirs.push(dir);
  const repo = join(dir, 'repo');
  const kvDir = join(dir, 'kv-slots');
  const prompts: string[] = [];
  const server = await startFakeLlamaServer({
    slotDir: kvDir,
    responder: (prompt) => (prompt.slice(prompt.lastIndexOf('<|turn>user')).includes('export CSV') ? `Je lance les tests. ${RUN}` : 'Fait.'),
    onCompletion: (body) => prompts.push(String(body['prompt'])),
  });
  servers.push(server);
  const client = new LlamaCppHttpClient(server.url);
  const store = new ConversationStore(join(dir, 'conversations'));
  const kv = new KvStore(kvDir);
  const engine = new ConversationEngine({
    store,
    kv,
    engine: async () => ({ client, family: gemma, live: LIVE, modelPath: 'gemma.gguf', kvBytesPerToken: 100, generation: 1, slidingWindow: 1024 }),
    prompt: () => ({ kind: 'code', tools: [], perimeter: [repo], replyLanguage: 'French' }),
  });
  const checkpoints = new CheckpointStore(join(dir, 'checkpoints'));
  const rewind = createRewind({ engine, checkpoints, store, family: () => gemma });
  const meta = await store.create({ kind: 'code', engineId: 'builtin', modelId: 'gemma', mode: 'plume' });
  const id = meta.id;
  await mkdir(repo, { recursive: true });
  const a = join(repo, 'weekly.ts');
  const csv = join(repo, 'csv.ts');
  await writeFile(a, 'v0', 'utf8');

  /** A turn, and what its tools wrote — kept as the tools keep it. */
  const turn = async (messageId: string, text: string, writes: [string, string, string][] = []) => {
    await engine.turn(id, { text, messageId }, () => undefined);
    for (const [path, display, content] of writes) {
      await checkpoints.before(id, messageId, path, display);
      await writeFile(path, content, 'utf8');
      await checkpoints.after(id, messageId, path);
    }
    await pause(5);
  };
  await turn('m1', 'Renomme formatHours en formatWeek partout.', [[a, 'weekly.ts', 'v1']]);
  await turn('m2', 'Corrige les heures décimales.');
  await turn('m3', 'Ajoute aussi un export CSV du récap.', [
    [a, 'weekly.ts', 'v3'],
    [csv, 'csv.ts', 'csv'],
  ]);
  // The agent's loop ran the command the answer called: its result, as the loop keeps it.
  const ran = [{ toolCallId: 't1', name: 'run_command', content: '2 failed' }];
  await (await openJournal(store.dir, id, (await store.get(id))!.branchId)).append({ kind: 'tool-results', results: ran, rendered: gemma.renderToolResults(ran) });
  const branchOf = async () => (await store.get(id))!.branchId;
  const entries = async (branchId?: string) => (await openJournal(store.dir, id, branchId ?? (await branchOf()))).entries();
  const target = { userIndex: 2, text: 'Ajoute aussi un export CSV du récap.' };
  return { id, engine, store, kv, rewind, checkpoints, prompts, a, csv, branchOf, entries, target };
}

// Several turns each: slow when the whole suite runs at once.
describe('going back before a message', { timeout: 30_000 }, () => {
  it('the code and the conversation: the files as before the message, a branch that starts before it, the old one kept with its memory', async () => {
    const { id, rewind, kv, prompts, a, csv, branchOf, entries, target, engine } = await rig();
    const before = await branchOf();
    const result = await rewind.rewind(id, target, 'both');

    expect(await readFile(a, 'utf8')).toBe('v1');
    expect(existsSync(csv)).toBe(false);
    expect([...result.filesRestored].sort()).toEqual(['csv.ts', 'weekly.ts']);
    expect(result.text).toBe(target.text);
    expect(result.fromBranchId).toBe(before);
    expect(result.branchId).toBe(await branchOf());
    expect(result.branchId).not.toBe(before);
    // What followed stays in the old branch, with its state saved.
    expect((await entries(before)).some((entry) => entry.kind === 'user' && entry.text === target.text)).toBe(true);
    expect(await kv.manifest(`${id}_${before}`)).not.toBeNull();
    // The new branch: up to the message before, and a record of the going back.
    const now = await entries();
    expect(now.some((entry) => entry.kind === 'user' && entry.text === target.text)).toBe(false);
    expect(now.at(-1)).toMatchObject({ kind: 'rewind', what: 'both', fromBranchId: before });

    // The next turn extends the prefix kept, byte for byte.
    const kept = frozenPrompt(now);
    await engine.turn(id, { text: 'Ajoute un export CSV, sans toucher aux colonnes.', messageId: 'm4' }, () => undefined);
    expect(prompts.at(-1)!.startsWith(kept)).toBe(true);
    // The message gone back before is no turn of the person's any more (the model's note may quote it).
    expect(prompts.at(-1)).not.toContain(gemma.renderUser(target.text));
  });

  it('a command already run is not undone: it is named, and the model hears of it', async () => {
    const { id, rewind, target, engine, prompts } = await rig();
    const result = await rewind.rewind(id, target, 'both');
    expect(result.commandsNotUndone).toEqual(['pnpm test']);
    await engine.turn(id, { text: 'Recommence.', messageId: 'm4' }, () => undefined);
    expect(prompts.at(-1)).toContain('pnpm test');
  });

  it('the conversation only: the files stay, and the model is told they kept the changes made after', async () => {
    const { id, rewind, a, csv, target, engine, prompts, branchOf } = await rig();
    const before = await branchOf();
    const result = await rewind.rewind(id, target, 'conversation');
    expect(result.filesRestored).toEqual([]);
    expect(await readFile(a, 'utf8')).toBe('v3');
    expect(existsSync(csv)).toBe(true);
    expect(result.branchId).not.toBe(before);
    await engine.turn(id, { text: 'Recommence.', messageId: 'm4' }, () => undefined);
    const note = prompts.at(-1)!;
    expect(note).toContain('The files were not put back');
    expect(note).toContain('csv.ts');
  });

  it('the code only: the files go back, the conversation stays on its branch, and the model is told which files', async () => {
    const { id, rewind, a, csv, target, engine, prompts, branchOf, entries } = await rig();
    const before = await branchOf();
    const result = await rewind.rewind(id, target, 'code');
    expect(await readFile(a, 'utf8')).toBe('v1');
    expect(existsSync(csv)).toBe(false);
    expect(result.branchId).toBe(before);
    expect((await entries()).some((entry) => entry.kind === 'user' && entry.text === target.text)).toBe(true);
    await engine.turn(id, { text: 'Et maintenant ?', messageId: 'm4' }, () => undefined);
    expect(prompts.at(-1)).toContain('put the files back');
    expect(prompts.at(-1)).toContain('weekly.ts');
  });

  it('going back can be undone: the files and the branch as they were, and nothing told to the model', async () => {
    const { id, rewind, a, csv, target, branchOf, engine, prompts } = await rig();
    const before = await branchOf();
    await rewind.rewind(id, target, 'both');
    const undone = await rewind.undo(id);
    expect(undone?.branchId).toBe(before);
    expect(await branchOf()).toBe(before);
    expect(await readFile(a, 'utf8')).toBe('v3');
    expect(await readFile(csv, 'utf8')).toBe('csv');

    await rewind.rewind(id, target, 'code');
    await rewind.undo(id);
    expect(await readFile(a, 'utf8')).toBe('v3');
    await engine.turn(id, { text: 'Et maintenant ?', messageId: 'm5' }, () => undefined);
    expect(prompts.at(-1)).not.toContain('put the files back');
    // Once a turn has begun, there is nothing left to undo.
    expect(await rewind.undo(id)).toBeNull();
  });

  it('keeps the window’s document of the branch left, and gives it back when the going back is undone', async () => {
    const { id, rewind, store, target } = await rig();
    await store.saveDocument(id, { id, messages: ['three turns, as shown'] });
    await rewind.rewind(id, target, 'both');
    // The page shows the new branch: the message gone back before, and what followed, taken out.
    await store.saveDocument(id, { id, messages: ['two turns, as shown'] });
    await rewind.undo(id);
    expect(await store.loadDocument(id)).toEqual({ id, messages: ['three turns, as shown'] });
  });

  it('says beforehand what going back would move — the files, the commands — and moves nothing', async () => {
    const { id, rewind, a, target, branchOf } = await rig();
    const before = await branchOf();
    const preview = await rewind.preview(id, target);
    expect([...preview.files].sort()).toEqual(['csv.ts', 'weekly.ts']);
    expect(preview.commands).toEqual(['pnpm test']);
    expect(await branchOf()).toBe(before);
    expect(await readFile(a, 'utf8')).toBe('v3');
  });

  it('says what its memory will cost: kept when llama.cpp resumes where the message began, read again when let go', async () => {
    const { id, rewind, store, target, engine } = await rig();
    expect((await rewind.preview(id, target)).memory).toBe('kept');
    // The memory let go (another conversation took the slot, then the person freed it): read again, said.
    const other = await store.create({ kind: 'code', engineId: 'builtin', modelId: 'gemma', mode: 'plume' });
    await engine.turn(other.id, { text: 'Ailleurs.', messageId: 'o1' }, () => undefined);
    await engine.release(id);
    const memory = (await rewind.preview(id, target)).memory;
    expect(memory).toMatchObject({ kind: 'reread', reason: 'evicted' });
    expect(memory !== 'kept' && memory !== null && memory.tokens).toBeGreaterThan(100);
    expect((await rewind.rewind(id, target, 'both')).memory).toMatchObject({ kind: 'reread' });
  });

  it('refuses a message that is not the one the window names: nothing moves', async () => {
    const { id, rewind, a, branchOf } = await rig();
    const before = await branchOf();
    await expect(rewind.rewind(id, { userIndex: 2, text: 'Un autre texte.' }, 'both')).rejects.toBeInstanceOf(RewindTargetError);
    await expect(rewind.rewind(id, { userIndex: 7, text: 'x' }, 'both')).rejects.toBeInstanceOf(RewindTargetError);
    expect(await branchOf()).toBe(before);
    expect(await readFile(a, 'utf8')).toBe('v3');
  });
});
