/**
 * Where models are looked for, through the bridge: a folder comes from the
 * system's dialog — the window names none —, and the whole-disk search is
 * started, followed and cancelled.
 */

import { describe, expect, it } from 'vitest';
import { registerMemoryChannels, registerModelChannels, type MemoryCore, type ModelsCore } from './models.js';
import { createIpcRegistry, type IpcMainLike } from './register.js';

type Listener = Parameters<IpcMainLike['handle']>[1];
const ours = 'bonaparte://app/index.html';
const IDLE = { running: false, done: false, cancelled: false, visited: 0, folders: [] };

function setup(chosen: string | null) {
  const added: string[] = [];
  let state = { ...IDLE };
  const core: ModelsCore = {
    addModelFolder: async (folder) => (added.push(folder), [...added]),
    diskScan: {
      start: () => void (state = { ...state, running: true }),
      state: () => state,
      cancel: () => void (state = { ...state, running: false, done: true, cancelled: true }),
    },
  };
  const listeners = new Map<string, Listener>();
  const ipcMain: IpcMainLike = { handle: (name, listener) => void listeners.set(name, listener) };
  registerModelChannels(createIpcRegistry({ ipcMain, isTrusted: (url) => url.startsWith('bonaparte://app/') }), core, async () => chosen);
  const call = (name: string, input?: unknown) => listeners.get(name)!({ senderFrame: { url: ours } }, input);
  return { call, added };
}

describe('the memory channels', () => {
  it('give the overview, let a memory go, unload and restart', async () => {
    const done: string[] = [];
    const core: MemoryCore = {
      memory: async () => ({ engine: { running: false, since: null, model: null, busy: false, nCtx: 8192, cacheType: 'f16', slots: 1 }, budgetBytes: 1, usedBytes: 0, rows: [], seed: null }),
      releaseMemory: async (id) => void done.push(`release ${id}`),
      resources: { start: () => undefined, last: () => null },
      diskCheck: async (id) => (id === 'full' ? { freeBytes: 1, drive: 'C:', needBytes: 2, release: ['old'], enough: true } : null),
      unloadModel: async () => void done.push('unload'),
      restartEngine: async () => void done.push('restart'),
    };
    const listeners = new Map<string, Listener>();
    const ipcMain: IpcMainLike = { handle: (name, listener) => void listeners.set(name, listener) };
    registerMemoryChannels(createIpcRegistry({ ipcMain, isTrusted: (url) => url.startsWith('bonaparte://app/') }), core);
    const call = (name: string, input?: unknown) => listeners.get(name)!({ senderFrame: { url: ours } }, input);
    await expect(call('engine.memory', undefined)).resolves.toMatchObject({ budgetBytes: 1 });
    await call('engine.releaseMemory', { id: 'c1' });
    await expect(call('engine.releaseMemory', { id: '' })).rejects.toThrow();
    // The disk nearly full, asked for one conversation (task 12.3).
    await expect(call('engine.diskCheck', { id: 'full' })).resolves.toMatchObject({ drive: 'C:', release: ['old'] });
    await expect(call('engine.diskCheck', { id: 'fine' })).resolves.toBeNull();
    await call('engine.unload', undefined);
    await call('engine.restart', undefined);
    expect(done).toEqual(['release c1', 'unload', 'restart']);
  });
});

describe('the model channels', () => {
  it('add the folder the person chose, and nothing when the dialog was closed', async () => {
    await expect(setup('D:/modeles').call('models.addFolder', undefined)).resolves.toEqual(['D:/modeles']);
    const closed = setup(null);
    await expect(closed.call('models.addFolder', undefined)).resolves.toBeNull();
    expect(closed.added).toEqual([]);
  });

  it('take no folder from the window', async () => {
    await expect(setup('D:/modeles').call('models.addFolder', 'C:/Windows')).rejects.toThrow();
  });

  it('start the whole-disk search, say how far it went, and cancel it', async () => {
    const { call } = setup(null);
    await expect(call('models.scanDisk', undefined)).resolves.toMatchObject({ running: true });
    await expect(call('models.scanState', undefined)).resolves.toMatchObject({ running: true });
    await expect(call('models.scanCancel', undefined)).resolves.toMatchObject({ running: false, cancelled: true });
  });
});
