/**
 * Everything the window asks the main process, except a turn of conversation,
 * goes through one typed bridge. Each call is checked twice before any code
 * runs for it: it must come from one of our pages, and its arguments must
 * match the channel's schema.
 */

import { defineChannel } from '@aparte/bonaparte-shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createIpcRegistry, IpcRefusedError, type IpcMainLike } from './register.js';

type Listener = Parameters<IpcMainLike['handle']>[1];

function fakeIpcMain() {
  const listeners = new Map<string, Listener>();
  const ipcMain: IpcMainLike = { handle: (name, listener) => void listeners.set(name, listener) };
  /** A call as Electron delivers it: the frame that sent it, then its argument. */
  const call = (name: string, senderUrl: string | undefined, input: unknown) =>
    listeners.get(name)!({ senderFrame: senderUrl === undefined ? null : { url: senderUrl } }, input);
  return { ipcMain, call };
}

const double = defineChannel('test.double', z.object({ n: z.number() }), z.object({ n: z.number() }));
const ours = 'bonaparte://app/index.html';
const trusted = (url: string) => url.startsWith('bonaparte://app/');

function setup() {
  const { ipcMain, call } = fakeIpcMain();
  const registry = createIpcRegistry({ ipcMain, isTrusted: trusted });
  const fn = vi.fn(async ({ n }: { n: number }) => ({ n: n * 2 }));
  registry.handle(double, fn);
  return { call, fn, registry };
}

describe('the IPC bridge', () => {
  it('runs the function for one of our pages, and returns what it returned', async () => {
    const { call, fn } = setup();
    await expect(call('test.double', ours, { n: 21 })).resolves.toEqual({ n: 42 });
    expect(fn).toHaveBeenCalledWith({ n: 21 });
  });

  it('refuses a call from another origin, before the function runs', async () => {
    const { call, fn } = setup();
    await expect(call('test.double', 'https://example.com/', { n: 1 })).rejects.toMatchObject({ code: 'origin' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses a call that has no frame to name', async () => {
    const { call, fn } = setup();
    await expect(call('test.double', undefined, { n: 1 })).rejects.toBeInstanceOf(IpcRefusedError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses arguments the channel does not describe, before the function runs', async () => {
    const { call, fn } = setup();
    await expect(call('test.double', ours, { n: 'one' })).rejects.toMatchObject({ code: 'input' });
    await expect(call('test.double', ours, undefined)).rejects.toMatchObject({ code: 'input' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not let out a result the channel does not describe', async () => {
    const { ipcMain, call } = fakeIpcMain();
    const registry = createIpcRegistry({ ipcMain, isTrusted: trusted });
    registry.handle(double, async () => ({ n: 'forty-two' }) as unknown as { n: number });
    await expect(call('test.double', ours, { n: 21 })).rejects.toMatchObject({ code: 'output' });
  });

  it('refuses to register a channel twice', () => {
    const { registry } = setup();
    expect(() => registry.handle(double, async ({ n }) => ({ n }))).toThrow(/test\.double/);
  });
});
