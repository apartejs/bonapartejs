/**
 * The window's side of the IPC bridge. The preload exposes one untyped
 * function; this gives it the types of the contract in `shared`, so that a
 * call names a channel and gets that channel's input and output.
 */

import type { AppEvent, Bridge } from '@aparte/bonaparte-shared';

declare global {
  interface Window {
    /** Exposed by the preload. */
    bonaparte: { invoke(name: string, input: unknown): Promise<unknown>; on(listener: (event: AppEvent) => void): () => void };
  }
}

export const bridge: Bridge = {
  invoke: (channel, input) => window.bonaparte.invoke(channel.name, input) as Promise<never>,
  on: (listener) => window.bonaparte.on(listener),
};
