/**
 * Démultiplexeur de flux Hermes : sépare, au fil des deltas, le texte visible
 * du raisonnement `<think>` et des appels `<tool_call>` (masqués).
 *
 * Difficulté réelle : une balise peut être coupée entre deux chunks réseau
 * (`…Bonjour <to` puis `ol_call>…`). Tout suffixe susceptible d'être le début
 * d'une balise est donc retenu jusqu'à levée d'ambiguïté — on ne laisse jamais
 * fuiter un fragment de balise dans l'UI.
 */

import { IM_END, THINK_CLOSE, THINK_OPEN, TOOL_CALL_CLOSE, TOOL_CALL_OPEN } from './hermes-parser.js';

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

/** Longueur du plus long suffixe pouvant être le début d'un marqueur. */
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

  push(delta: string): DemuxEvent[] {
    this.rawOutput += delta;
    if (this.mode === 'done') return [];
    this.buffer += delta;
    const events: DemuxEvent[] = [];
    this.drain(events, false);
    return events;
  }

  /** Sortie brute accumulée, verbatim (log append-only + parse final). */
  get raw(): string {
    return this.rawOutput;
  }

  /** Vide les retenues en fin de génération. */
  flush(): DemuxEvent[] {
    const events: DemuxEvent[] = [];
    this.drain(events, true);
    // Appel d'outil non refermé : son contenu partiel ne doit jamais fuiter.
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
        if (close === -1) return; // tout est masqué, on attend la fermeture
        this.buffer = this.buffer.slice(close + TOOL_CALL_CLOSE.length);
        this.mode = 'text';
        continue;
      }

      const inThink = this.mode === 'think';
      const markers = inThink ? [THINK_CLOSE] : TEXT_MARKERS;
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
