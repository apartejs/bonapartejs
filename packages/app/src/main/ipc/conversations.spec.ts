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
  const listeners = new Map<string, Listener>();
  const ipcMain: IpcMainLike = { handle: (name, listener) => void listeners.set(name, listener) };
  const ipc = createIpcRegistry({ ipcMain, isTrusted: (url) => url.startsWith('bonaparte://app/') });
  registerConversationChannels(ipc, {
    conversationStore: store,
    conversations: { open: open as never },
    // The core's delete: the conversation and the originals its turns kept.
    removeConversation: async (id: string) => {
      removed.push(id);
      await store.remove(id);
    },
  });
  const call = (name: string, input: unknown) => listeners.get(name)!({ senderFrame: { url: ours } }, input);
  return { call, store, removed };
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
});
