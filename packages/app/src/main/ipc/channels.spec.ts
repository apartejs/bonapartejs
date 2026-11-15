/**
 * Every channel between the window and the main process, reviewed as one
 * (task 5.1, security rule 1): each has a schema for what comes in and what
 * goes out; the main process serves exactly the channels the contract
 * declares; and no channel lets the window choose an executable or a
 * command — what runs is the core's choice, never the page's.
 */

import { CHANNELS } from '@aparte/bonaparte-shared';
import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { createIpcRegistry, type IpcMainLike } from './register.js';
import { registerAllChannels } from './index.js';

/** A core whose every method exists: registering a channel never calls it. */
const anyCore = new Proxy({}, { get: () => new Proxy(() => undefined, { get: () => () => undefined }) }) as never;

/** Keys that would let the page choose what runs. */
const RUNS = /^(program|command|cmd|executable|exe|binary|bin|args|argv|cwd|shell|script|llamaBin|llamaCommand)$/i;

function keysOf(schema: unknown, into: string[] = []): string[] {
  if (Array.isArray(schema)) {
    for (const item of schema) keysOf(item, into);
  } else if (typeof schema === 'object' && schema !== null) {
    for (const [key, value] of Object.entries(schema)) {
      if (key === 'properties' && typeof value === 'object' && value !== null) into.push(...Object.keys(value));
      keysOf(value, into);
    }
  }
  return into;
}

describe('the channels of the bridge', () => {
  it('each has a name of its own, and a schema for what comes in and what goes out', () => {
    const names = CHANNELS.map((channel) => channel.name);
    expect(new Set(names).size).toBe(names.length);
    for (const channel of CHANNELS) {
      expect(typeof channel.input.safeParse, channel.name).toBe('function');
      expect(typeof channel.output.safeParse, channel.name).toBe('function');
    }
  });

  it('the main process serves exactly the channels the contract declares', () => {
    const served: string[] = [];
    const ipcMain: IpcMainLike = { handle: (name) => void served.push(name) };
    registerAllChannels(createIpcRegistry({ ipcMain, isTrusted: () => true }), anyCore, {
      version: () => '0',
      locale: () => 'fr',
      chooseFolder: async () => null,
      openDataFolder: async () => undefined,
    });
    expect([...served].sort()).toEqual(CHANNELS.map((channel) => channel.name).sort());
  });

  it('no channel lets the window choose an executable or a command', () => {
    for (const channel of CHANNELS) {
      const keys = keysOf(toJSONSchema(channel.input, { unrepresentable: 'any' }));
      expect(keys.filter((key) => RUNS.test(key)), channel.name).toEqual([]);
    }
  });
});
