/**
 * What is known of a conversation besides its journal: its title, its kind,
 * its project, its engine and model, its mode, its marks. One small file per
 * conversation, rewritten whole and never seen half-written.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openJournal } from '../journal/journal.js';
import { ConversationStore } from './store.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function store(): Promise<{ store: ConversationStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-conversations-'));
  dirs.push(dir);
  return { store: new ConversationStore(dir), dir };
}

const NEW = { kind: 'code', engineId: 'builtin', modelId: 'gemma-4', mode: 'repetition' } as const;

describe('ConversationStore', () => {
  it('creates a conversation on its main branch, untitled until its first message names it', async () => {
    const { store: conversations } = await store();
    const meta = await conversations.create(NEW);
    expect(meta).toMatchObject({ ...NEW, title: '', branchId: 'main' });
    expect(meta.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]+$/);
    expect(await conversations.get(meta.id)).toEqual(meta);
  });

  it('lists the most recent first, and passes over a folder that is not a conversation', async () => {
    const { store: conversations, dir } = await store();
    const first = await conversations.create(NEW);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await conversations.create(NEW);
    await mkdir(join(dir, 'not-a-conversation'));
    await mkdir(join(dir, 'broken'));
    await writeFile(join(dir, 'broken', 'meta.json'), '{ nope');
    expect((await conversations.list()).map((meta) => meta.id)).toEqual([second.id, first.id]);
  });

  it('dates an update, but not a mark: pinning or archiving is not activity', async () => {
    const { store: conversations } = await store();
    const meta = await conversations.create(NEW);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const renamed = await conversations.update(meta.id, { title: 'Le recap des heures' });
    expect(renamed.updatedAt > meta.updatedAt).toBe(true);
    const pinned = await conversations.mark(meta.id, { pinnedAt: '2026-11-14T20:00:00.000Z' });
    expect(pinned.updatedAt).toBe(renamed.updatedAt);
    expect(pinned.pinnedAt).toBe('2026-11-14T20:00:00.000Z');
  });

  it('two updates at the same time both land', async () => {
    const { store: conversations } = await store();
    const meta = await conversations.create(NEW);
    await Promise.all([conversations.update(meta.id, { title: 'A' }), conversations.update(meta.id, { contextCap: 4096 })]);
    expect(await conversations.get(meta.id)).toMatchObject({ title: 'A', contextCap: 4096 });
  });

  it('removes a conversation whole — its journal with it', async () => {
    const { store: conversations, dir } = await store();
    const meta = await conversations.create(NEW);
    const journal = await openJournal(dir, meta.id);
    await journal.append({ kind: 'system', rendered: 'S' });
    await conversations.remove(meta.id);
    expect(await conversations.get(meta.id)).toBeNull();
    expect(await conversations.list()).toEqual([]);
  });

  it('refuses an id that would leave its folder, for every operation', async () => {
    const { store: conversations } = await store();
    await expect(conversations.get('../x')).rejects.toThrow(/conversation id/);
    await expect(conversations.update('..\\x', { title: 'x' })).rejects.toThrow(/conversation id/);
    await expect(conversations.remove('../x')).rejects.toThrow(/conversation id/);
  });

  it('an unknown conversation is null to read, and an error to change', async () => {
    const { store: conversations } = await store();
    expect(await conversations.get('nope')).toBeNull();
    await expect(conversations.update('nope', { title: 'x' })).rejects.toThrow(/no conversation/);
  });
});
