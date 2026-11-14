/**
 * The contract of the IPC bridge. A channel is declared once, here in
 * `shared`, with the schema of what goes in and of what comes out; the main
 * process registers a function for it, the window invokes it, and both are
 * typed by the same declaration.
 *
 * A turn of conversation does not go through this bridge: it is a streamed
 * request on `bonaparte://app/agent` (see `agent.ts`).
 */

import type { ZodType } from 'zod';

export interface Channel<I, O> {
  readonly name: string;
  readonly input: ZodType<I>;
  readonly output: ZodType<O>;
}

export function defineChannel<I, O>(name: string, input: ZodType<I>, output: ZodType<O>): Channel<I, O> {
  return { name, input, output };
}

/** What the window sees of the bridge. The preload exposes it as `window.bonaparte`. */
export interface Bridge {
  invoke<I, O>(channel: Channel<I, O>, input: I): Promise<O>;
}
