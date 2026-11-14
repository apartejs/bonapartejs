/**
 * The main-process side of the IPC bridge. Each call is checked twice before
 * any code runs for it: it must come from one of our pages, and its arguments
 * must match the schema of its channel. What goes back is checked too.
 *
 * It takes Electron's `ipcMain` as a parameter, so that it is tested without
 * Electron.
 */

import type { Channel } from '@aparte/bonaparte-shared';

/** The part of an IPC event this module reads. */
export interface IpcEventLike {
  senderFrame: { url: string } | null;
}

/** The part of Electron's `ipcMain` this module uses. */
export interface IpcMainLike {
  handle(name: string, listener: (event: IpcEventLike, input: unknown) => Promise<unknown>): void;
}

export class IpcRefusedError extends Error {
  constructor(
    readonly code: 'origin' | 'input' | 'output',
    channel: string,
  ) {
    super(`IPC call refused on ${channel}: ${code}.`);
    this.name = 'IpcRefusedError';
  }
}

export interface IpcRegistry {
  handle<I, O>(channel: Channel<I, O>, fn: (input: I) => Promise<O> | O): void;
}

export function createIpcRegistry(options: {
  ipcMain: IpcMainLike;
  /** Is this frame URL one of our pages? */
  isTrusted: (url: string) => boolean;
}): IpcRegistry {
  const registered = new Set<string>();

  return {
    handle(channel, fn) {
      if (registered.has(channel.name)) throw new Error(`IPC channel registered twice: ${channel.name}`);
      registered.add(channel.name);

      options.ipcMain.handle(channel.name, async (event, raw) => {
        const sender = event.senderFrame?.url;
        if (sender === undefined || !options.isTrusted(sender)) throw new IpcRefusedError('origin', channel.name);
        const input = channel.input.safeParse(raw);
        if (!input.success) throw new IpcRefusedError('input', channel.name);
        const output = channel.output.safeParse(await fn(input.data));
        if (!output.success) throw new IpcRefusedError('output', channel.name);
        return output.data;
      });
    },
  };
}
