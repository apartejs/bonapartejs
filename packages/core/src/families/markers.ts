/**
 * What every stream demultiplexer needs: find the next marker in what has
 * arrived, and hold back a suffix that may be the start of one — a tag can be
 * cut between two chunks (`…Hello <|tool_` then `call>…`), and a fragment of
 * a tag must never leak into the window.
 */

export function firstMarker(buffer: string, markers: readonly string[]): { index: number; marker: string } | null {
  let best: { index: number; marker: string } | null = null;
  for (const marker of markers) {
    const index = buffer.indexOf(marker);
    if (index !== -1 && (best === null || index < best.index)) best = { index, marker };
  }
  return best;
}

/** Length of the longest suffix that could be the start of a marker. */
export function heldBackLength(buffer: string, markers: readonly string[]): number {
  const longest = Math.max(...markers.map((marker) => marker.length)) - 1;
  const start = Math.max(0, buffer.length - longest);
  for (let i = start; i < buffer.length; i++) {
    const suffix = buffer.slice(i);
    if (markers.some((marker) => marker.startsWith(suffix))) return buffer.length - i;
  }
  return 0;
}
