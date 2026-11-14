/**
 * Hermes stream demultiplexer: separates, delta by delta, the visible
 * text from the `<think>` reasoning and the `<tool_call>` calls (hidden).
 *
 * Real difficulty: a tag can be cut between two network chunks
 * (`…Hello <to` then `ol_call>…`). Any suffix that could be the start of
 * a tag is therefore held back until the ambiguity is resolved — we never
 * let a tag fragment leak into the UI.
 */

import { IM_END, THINK_CLOSE, THINK_OPEN, TOOL_CALL_CLOSE, TOOL_CALL_OPEN } from './parser.js';

export type DemuxEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string };

type DemuxMode = 'text' | 'think' | 'call' | 'done';

const TEXT_MARKERS = [THINK_OPEN, TOOL_CALL_OPEN, IM_END];

function firstMarker(
  buffer: string,
  markers: string[],
): { index: number; marker: string } | null {
  let best: { index: number; marker: string } | null = null;
  for (const marker of markers) {
    const index = buffer.indexOf(marker);
    if (index !== -1 && (best === null || index < best.index)) {
      best = { index, marker };
    }
  }
  return best;
}

/** Length of the longest suffix that could be the start of a marker. */
function heldBackLength(buffer: string, markers: string[]): number {
  const longest = Math.max(...markers.map((m) => m.length)) - 1;
  const start = Math.max(0, buffer.length - longest);
  for (let i = start; i < buffer.length; i++) {
    const suffix = buffer.slice(i);
    if (markers.some((marker) => marker.startsWith(suffix))) {
      return buffer.length - i;
    }
  }
  return 0;
}

export class HermesStreamDemux {
  private mode: DemuxMode = 'text';
  private buffer = '';
  private rawOutput = '';
  private readonly markers: string[] = TEXT_MARKERS;

  push(delta: string): DemuxEvent[] {
    this.rawOutput += delta;
    if (this.mode === 'done') return [];
    this.buffer += delta;
    const events: DemuxEvent[] = [];
    this.drain(events, false);
    return events;
  }

  /** Accumulated raw output, verbatim (append-only log + final parse). */
  get raw(): string {
    return this.rawOutput;
  }

  /** Flushes the held-back data at the end of generation. */
  flush(): DemuxEvent[] {
    const events: DemuxEvent[] = [];
    this.drain(events, true);
    // Unclosed tool call: its partial content must never leak.
    this.buffer = '';
    return events;
  }

  private drain(events: DemuxEvent[], final: boolean): void {
    for (;;) {
      if (this.mode === 'done') {
        this.buffer = '';
        return;
      }

      if (this.mode === 'call') {
        const close = this.buffer.indexOf(TOOL_CALL_CLOSE);
        if (close === -1) return; // everything is hidden, we wait for the closing tag
        this.buffer = this.buffer.slice(close + TOOL_CALL_CLOSE.length);
        this.mode = 'text';
        continue;
      }

      const inThink = this.mode === 'think';
      const markers = inThink ? [THINK_CLOSE] : this.markers;
      const type = inThink ? ('thinking' as const) : ('text' as const);
      const found = firstMarker(this.buffer, markers);

      if (found) {
        if (found.index > 0) {
          events.push({ type, delta: this.buffer.slice(0, found.index) });
        }
        this.buffer = this.buffer.slice(found.index + found.marker.length);
        if (inThink) this.mode = 'text';
        else if (found.marker === IM_END) this.mode = 'done';
        else this.mode = found.marker === THINK_OPEN ? 'think' : 'call';
        continue;
      }

      const held = final ? 0 : heldBackLength(this.buffer, markers);
      const emit = this.buffer.slice(0, this.buffer.length - held);
      if (emit) events.push({ type, delta: emit });
      this.buffer = held > 0 ? this.buffer.slice(this.buffer.length - held) : '';
      return;
    }
  }
}

export const DEMUX_MARKERS = {
  IM_END,
  THINK_CLOSE,
  THINK_OPEN,
  TOOL_CALL_CLOSE,
  TOOL_CALL_OPEN,
};
