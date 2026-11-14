/**
 * Gemma 4's output, delta by delta: the thought channel
 * (`<|channel>thought\n…<channel|>`) becomes reasoning, a call
 * (`<|tool_call>call:…<tool_call|>`) is given whole once it closes, any
 * other channel is hidden, and the end of the turn ends it. A tag cut
 * between two chunks never leaks: a suffix that may start one is held back.
 */

import { firstMarker, heldBackLength } from '../markers.js';
import type { DemuxEvent, StreamDemux } from '../types.js';
import { parseGemmaCall } from './parser.js';
import { CHANNEL_CLOSE, CHANNEL_OPEN, TOOL_CALL_CLOSE, TOOL_CALL_OPEN, TOOL_RESPONSE_OPEN, TURN_CLOSE } from './template.js';

type Mode = 'text' | 'channel-name' | 'thought' | 'hidden' | 'call' | 'done';

const TEXT_MARKERS = [CHANNEL_OPEN, CHANNEL_CLOSE, TOOL_CALL_OPEN, TURN_CLOSE, TOOL_RESPONSE_OPEN];
const CLOSE_MARKERS = [CHANNEL_CLOSE];

export class GemmaStreamDemux implements StreamDemux {
  private mode: Mode = 'text';
  private buffer = '';
  private rawOutput = '';
  /** The whitespace after `thought` is the channel's, not the reasoning's. */
  private trimLeading = false;

  push(delta: string): DemuxEvent[] {
    this.rawOutput += delta;
    if (this.mode === 'done') return [];
    this.buffer += delta;
    const events: DemuxEvent[] = [];
    this.drain(events, false);
    return events;
  }

  flush(): DemuxEvent[] {
    const events: DemuxEvent[] = [];
    this.drain(events, true);
    if (this.mode === 'call' && this.buffer !== '') events.push({ type: 'tool-call-malformed', raw: this.buffer });
    this.buffer = '';
    return events;
  }

  get raw(): string {
    return this.rawOutput;
  }

  private emitThinking(events: DemuxEvent[], text: string): void {
    let delta = text;
    if (this.trimLeading) {
      delta = delta.replace(/^\s+/, '');
      if (delta !== '') this.trimLeading = false;
    }
    if (delta !== '') events.push({ type: 'thinking', delta });
  }

  private drain(events: DemuxEvent[], final: boolean): void {
    for (;;) {
      switch (this.mode) {
        case 'done':
          this.buffer = '';
          return;

        case 'call': {
          const close = this.buffer.indexOf(TOOL_CALL_CLOSE);
          if (close === -1) return; // hidden until it closes
          const body = this.buffer.slice(0, close);
          const call = parseGemmaCall(body);
          events.push(call ? { type: 'tool-call', name: call.name, input: call.arguments } : { type: 'tool-call-malformed', raw: body });
          this.buffer = this.buffer.slice(close + TOOL_CALL_CLOSE.length);
          this.mode = 'text';
          continue;
        }

        case 'channel-name': {
          const name = /^[a-z_]*/i.exec(this.buffer)![0];
          if (name.length === this.buffer.length && !final) return; // the name may go on
          this.buffer = this.buffer.slice(name.length);
          this.mode = name === 'thought' ? 'thought' : 'hidden';
          this.trimLeading = true;
          continue;
        }

        case 'thought':
        case 'hidden': {
          const found = firstMarker(this.buffer, CLOSE_MARKERS);
          if (found) {
            if (this.mode === 'thought') this.emitThinking(events, this.buffer.slice(0, found.index));
            this.buffer = this.buffer.slice(found.index + found.marker.length);
            this.mode = 'text';
            continue;
          }
          const held = final ? 0 : heldBackLength(this.buffer, CLOSE_MARKERS);
          if (this.mode === 'thought') this.emitThinking(events, this.buffer.slice(0, this.buffer.length - held));
          this.buffer = this.buffer.slice(this.buffer.length - held);
          return;
        }

        case 'text': {
          const found = firstMarker(this.buffer, TEXT_MARKERS);
          if (found) {
            if (found.index > 0) events.push({ type: 'text', delta: this.buffer.slice(0, found.index) });
            this.buffer = this.buffer.slice(found.index + found.marker.length);
            if (found.marker === CHANNEL_OPEN) this.mode = 'channel-name';
            else if (found.marker === TOOL_CALL_OPEN) this.mode = 'call';
            else if (found.marker === CHANNEL_CLOSE) this.mode = 'text'; // a stray closer: swallowed
            else this.mode = 'done';
            continue;
          }
          const held = final ? 0 : heldBackLength(this.buffer, TEXT_MARKERS);
          const emit = this.buffer.slice(0, this.buffer.length - held);
          if (emit) events.push({ type: 'text', delta: emit });
          this.buffer = this.buffer.slice(this.buffer.length - held);
          return;
        }
      }
    }
  }
}
