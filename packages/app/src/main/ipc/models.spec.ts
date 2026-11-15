/**
 * Where models are looked for, through the bridge: a folder comes from the
 * system's dialog — the window names none —, and the whole-disk search is
 * started, followed and cancelled.
 */

import { describe, expect, it } from 'vitest';
import { registerModelChannels, type ModelsCore } from './models.js';
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
