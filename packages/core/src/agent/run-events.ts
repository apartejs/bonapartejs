/**
 * The wire of a turn is NDJSON, one event per line: aparté's run events as
 * they are (the types come from `@aparte/engine`, never redeclared here), plus
 * the one line a server adds — `run-error`, when a run fails after its stream
 * began.
 */

import type { StreamRunEvent } from '@aparte/engine';

export type RunEvent = StreamRunEvent;

export type WireLine = RunEvent | { type: 'run-error'; message: string; code?: string };

export function encodeEvent(event: WireLine): string {
  return `${JSON.stringify(event)}\n`;
}
