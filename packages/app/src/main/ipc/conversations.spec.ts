/**
 * The window's conversations through the bridge: aparté's storage adapter on
 * the core's store, and what opening one costs. A document is kept as it was
 * saved; a conversation is deleted whole; the window names no path.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationStore } from '@aparte/bonaparte-core';
import { afterEach, describe, expect, it } from 'vitest';
import { createIpcRegistry, type IpcMainLike } from './register.js';
import { registerConversationChannels } from './conversations.js';

type Listener = Parameters<IpcMainLike['handle']>[1];
const ours = 'bonaparte://app/index.html';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function setup(open: (id: string) => Promise<unknown> = async () => null) {
  const dir = await mkdtemp(join(tmpdir(), 'bp-ipc-conversations-'));
  dirs.push(dir);
  const store = new ConversationStore(dir);
  const removed: string[] = [];
  const marked: string[] = [];
  const listeners = new Map<string, Listener>();
  const ipcMain: IpcMainLike = { handle: (name, listener) => void listeners.set(name, listener) };
  const ipc = createIpcRegistry({ ipcMain, isTrusted: (url) => url.startsWith('bonaparte://app/') });
  registerConversationChannels(ipc, {
    conversationStore: store,
    conversations: {
      open: open as never,
      status: async (id: string) => {
        if (id === 'broken') throw new Error('The journal of broken cannot be read at line 3');
        return id === 'c-1' ? { memory: 'saved' as const, waiting: true, unread: false } : null;
      },
      markSeen: async (id: string) => void marked.push(`seen ${id}`),
    },
    readAgain: async () => undefined,
    conversationDocument: (id: string) => store.loadDocument(id),
    branchOf: async () => null,
    prOf: async () => null,
    inbox: async () => ({ approvals: [], subagentRequests: [], questions: [], ciFailures: [], costs: [], unread: [] }),
    openPr: async () => null,
    uncommitted: async () => 0,
    commitBranch: async () => false,
    conversationArchived: async () => undefined,
    rewindPreview: async () => ({ files: [], commands: [], memory: null }),
    rewind: async () => {
      throw new Error('not in this test');
    },
    undoRewind: async () => null,
    branches: { list: async () => [], switchTo: async () => undefined, follow: async () => null },
    compact: async () => ({ ok: false, reason: 'not-worth' }),
    uncompact: async () => 'main',
    contextOf: async () => null,
    serviceOf: async () => undefined,
    attachProject: async () => undefined,
    // The core's delete: the conversation and the originals its turns kept.
    removeConversation: async (id: string) => {
      removed.push(id);
      await store.remove(id);
    },
  }, { seen: () => void marked.push('told') });
  const call = (name: string, input: unknown) => listeners.get(name)!({ senderFrame: { url: ours } }, input);
  return { call, store, removed, marked };
}

const DOC = { id: 'c-1', title: '', createdAt: 1, updatedAt: 1, messages: [{ id: 'm1', role: 'user', content: 'Bonjour' }] };

describe('the conversation channels', () => {
  it('save a document — the conversation made if the page saves before its first turn — and give it back', async () => {
    const { call, store } = await setup();
    await call('conversations.save', { document: DOC });
    expect(await store.get('c-1')).toMatchObject({ id: 'c-1', branchId: 'main' });
    await expect(call('conversations.loadFull', { id: 'c-1' })).resolves.toEqual(DOC);
    await expect(call('conversations.loadAll', undefined)).resolves.toEqual([DOC]);
    await expect(call('conversations.loadFull', { id: 'nope' })).resolves.toBeNull();
  });

  it('delete a conversation whole, through the engine that owns its memory', async () => {
    const { call, removed } = await setup();
    await call('conversations.save', { document: DOC });
    await call('conversations.delete', { id: 'c-1' });
    expect(removed).toEqual(['c-1']);
    await expect(call('conversations.loadAll', undefined)).resolves.toEqual([]);
  });

  it('say what opening a conversation costs', async () => {
    const restore = { kind: 'restore', tokens: 31240, seconds: 0.6, insteadOfSeconds: 240, bytes: 1, savedAt: 'x', estimated: false };
    const { call } = await setup(async () => restore);
    await expect(call('conversations.memory', { id: 'c-1' })).resolves.toEqual({ announcement: restore });
  });

  it('refuse a document without an id, or an id that is a path, before the core hears of it', async () => {
    const { call } = await setup();
    await expect(call('conversations.save', { document: { title: 'x' } })).rejects.toThrow(/input/);
    await expect(call('conversations.save', { document: { ...DOC, id: '../x' } })).rejects.toThrow(/conversation id/);
  });

  it('list the cards for the sidebar — titles from the page, dates, pins, archives — without reading the documents', async () => {
    const { call } = await setup();
    await call('conversations.save', { document: { ...DOC, title: 'Bonjour' } });
    const [card] = (await call('conversations.loadMeta', undefined)) as { id: string; title: string; createdAt: number; pinnedAt?: number }[];
    expect(card).toMatchObject({ id: 'c-1', title: 'Bonjour' });
    expect(typeof card!.createdAt).toBe('number');
    await call('conversations.pin', { id: 'c-1' });
    await call('conversations.rename', { id: 'c-1', title: 'Le parseur' });
    await call('conversations.archive', { id: 'c-1' });
    const [changed] = (await call('conversations.loadMeta', undefined)) as { title: string; pinnedAt?: number; archivedAt?: number }[];
    expect(changed).toMatchObject({ title: 'Le parseur' });
    expect(typeof changed!.pinnedAt).toBe('number');
    expect(typeof changed!.archivedAt).toBe('number');
    await call('conversations.unpin', { id: 'c-1' });
    await call('conversations.unarchive', { id: 'c-1' });
    const [back] = (await call('conversations.loadMeta', undefined)) as { pinnedAt?: number; archivedAt?: number }[];
    expect(back!.pinnedAt).toBeUndefined();
    expect(back!.archivedAt).toBeUndefined();
  });

  it('keep the draft of the composer, conversation by conversation', async () => {
    const { call } = await setup();
    await call('conversations.save', { document: DOC });
    await expect(call('conversations.loadDraft', { id: 'c-1' })).resolves.toBeNull();
    await call('conversations.saveDraft', { id: 'c-1', text: 'Une idée' });
    await expect(call('conversations.loadDraft', { id: 'c-1' })).resolves.toBe('Une idée');
  });

  it('one conversation whose journal cannot be read leaves only its own row without marks (review of phase 8)', async () => {
    const { call } = await setup();
    await call('conversations.save', { document: DOC });
    await expect(call('conversations.status', { ids: ['broken', 'c-1'] })).resolves.toEqual({
      'c-1': { projectId: null, kind: 'code', memory: 'saved', waiting: true, unread: false },
    });
  });

  it('a conversation seen is marked, then the main process is told — the notification area forgets its reply ready', async () => {
    const { call, marked } = await setup();
    await call('conversations.seen', { id: 'c-1' });
    expect(marked).toEqual(['seen c-1', 'told']);
  });

  it("say what the sidebar shows of each conversation asked: its memory, whether it waits, whether it was read — nothing for one that is gone", async () => {
    const { call, store } = await setup();
    await call('conversations.save', { document: DOC });
    await expect(call('conversations.status', { ids: ['c-1', 'gone'] })).resolves.toEqual({
      'c-1': { projectId: null, kind: 'code', memory: 'saved', waiting: true, unread: false },
    });
    await store.update('c-1', { projectId: 'p-1' });
    await expect(call('conversations.status', { ids: ['c-1'] })).resolves.toEqual({
      'c-1': { projectId: 'p-1', kind: 'code', memory: 'saved', waiting: true, unread: false },
    });
    await expect(call('conversations.status', { ids: Array.from({ length: 501 }, (_, n) => `c-${n}`) })).rejects.toThrow();
  });
});

