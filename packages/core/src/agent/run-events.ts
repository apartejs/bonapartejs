/**
 * The wire of a turn is NDJSON, one event per line: aparté's run events as
 * they are (the types come from `@aparte/engine`, never redeclared here), plus
 * the one line a server adds — `run-error`, when a run fails after its stream
 * began.
 *
 * No test checks that our events are aparté's: `RunEvent` IS aparté's type,
 * and the handler can only write a `WireLine`. The compiler holds it. What a
 * test can check is that aparté's real runner reads what we write: see
 * `contract.spec.ts`.
 */

import type { StreamRunEvent } from '@aparte/engine';

export type RunEvent = StreamRunEvent;

export type WireLine =
  | RunEvent
  | { type: 'run-error'; message: string; code?: string }
  /** A pause, as aparté's server loop writes it on the wire: with the ticket that resumes it. */
  | (Extract<RunEvent, { type: 'run-suspended' }> & { ticket: string });

export function encodeEvent(event: WireLine): string {
  return `${JSON.stringify(event)}\n`;
}
