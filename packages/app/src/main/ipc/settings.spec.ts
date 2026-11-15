/**
 * A setting read through the bridge (task 5.9; the pages write them in 5.7),
 * and the export of the conversations: the folder is chosen in the system's
 * dialog, never by the window, and what names the person and the assistant
 * is the window's words, checked first.
 */

import { describe, expect, it } from 'vitest';
import { createIpcRegistry, type IpcMainLike } from './register.js';
import { registerExportChannel, registerSettingsChannels } from './settings.js';

type Listener = Parameters<IpcMainLike['handle']>[1];
const ours = 'bonaparte://app/index.html';

function setup(chosen: string | null = 'C:/Users/me/Documents') {
  const exported: unknown[] = [];
  const listeners = new Map<string, Listener>();
  const ipcMain: IpcMainLike = { handle: (name, listener) => void listeners.set(name, listener) };
  const ipc = createIpcRegistry({ ipcMain, isTrusted: (url) => url.startsWith('bonaparte://app/') });
  const written: unknown[] = [];
  let opened = 0;
  registerSettingsChannels(
    ipc,
    {
      settings: {
        get: async (key) => {
          if (key !== 'reopenLast') throw new Error(`Unknown setting: ${key}`);
          return false;
        },
        all: async () => [{ key: 'reopenLast', value: false }],
        set: async (key, value) => {
          if (key !== 'reopenLast' || typeof value !== 'boolean') throw new Error(`Setting ${key} expects a boolean`);
          written.push([key, value]);
        },
      },
    },
    async () => void (opened += 1),
  );
  registerExportChannel(
    ipc,
    {
      exportConversations: async (into, labels) => {
        exported.push({ into, labels });
        return { folder: `${into}/bonaparte-2026-11-15`, count: 3 };
      },
    },
    async () => chosen,
  );
  const call = (name: string, input?: unknown) => listeners.get(name)!({ senderFrame: { url: ours } }, input);
  return { call, exported, written, opened: () => opened };
}

const LABELS = { person: 'Toi', assistant: 'bonaparte', untitled: 'Nouvelle conversation' };

describe('the settings channel', () => {
  it('reads a setting as the person left it', async () => {
    await expect(setup().call('settings.get', { key: 'reopenLast' })).resolves.toBe(false);
  });

  it('lists the settings, and keeps a change the core accepts — never one it refuses', async () => {
    const { call, written } = setup();
    await expect(call('settings.all', undefined)).resolves.toEqual([{ key: 'reopenLast', value: false }]);
    await call('settings.set', { key: 'reopenLast', value: true });
    await expect(call('settings.set', { key: 'reopenLast', value: 'yes' })).rejects.toThrow(/boolean/);
    expect(written).toEqual([['reopenLast', true]]);
  });

  it('opens the data folder, whose path the window never names', async () => {
    const { call, opened } = setup();
    await call('app.openDataFolder', undefined);
    expect(opened()).toBe(1);
  });

  it('refuses a key that is not a setting', async () => {
    await expect(setup().call('settings.get', { key: 'nope' })).rejects.toThrow(/Unknown setting/);
    await expect(setup().call('settings.get', { key: '' })).rejects.toThrow();
  });
});

describe('the export channel', () => {
  it('exports into the folder the person chose in the system dialog', async () => {
    const { call, exported } = setup();
    await expect(call('conversations.export', { labels: LABELS })).resolves.toEqual({ folder: 'C:/Users/me/Documents/bonaparte-2026-11-15', count: 3 });
    expect(exported).toEqual([{ into: 'C:/Users/me/Documents', labels: LABELS }]);
  });

  it('does nothing when the person closes the dialog', async () => {
    const { call, exported } = setup(null);
    await expect(call('conversations.export', { labels: LABELS })).resolves.toBeNull();
    expect(exported).toEqual([]);
  });

  it('takes no folder from the window', async () => {
    const { call } = setup();
    await expect(call('conversations.export', { labels: LABELS, into: 'C:/Windows' })).rejects.toThrow();
  });
});
