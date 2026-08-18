import { describe, expect, it } from 'vitest';
import { SegmentWriter } from './segment-writer.js';

/** Ordonnanceur manuel : la frame ne part que quand le test le décide. */
function rig() {
  const written: [string, string][] = [];
  let queued: (() => void) | null = null;
  const writer = new SegmentWriter(
    (id, content) => written.push([id, content]),
    (cb) => {
      queued = cb;
      return 1;
    },
    () => {
      queued = null;
    },
  );
  return { writer, written, frame: (): void => queued?.() };
}

describe('SegmentWriter', () => {
  it('n’écrit rien avant la frame', () => {
    const { writer, written } = rig();
    writer.append('s', 'a');
    writer.append('s', 'b');
    expect(written).toEqual([]);
  });

  it('écrit une seule fois par frame, deltas concaténés', () => {
    const { writer, written, frame } = rig();
    writer.append('s', 'Bon');
    writer.append('s', 'jour');
    frame();
    expect(written).toEqual([['s', 'Bonjour']]);
  });

  it('sépare les segments et garde leur ordre d’apparition', () => {
    const { writer, written, frame } = rig();
    writer.append('think', 'hmm');
    writer.append('text', 'Salut');
    writer.append('think', '…');
    frame();
    expect(written).toEqual([
      ['think', 'hmm…'],
      ['text', 'Salut'],
    ]);
  });

  it('flush() vide immédiatement, sans attendre la frame', () => {
    const { writer, written } = rig();
    writer.append('s', 'a');
    writer.flush();
    expect(written).toEqual([['s', 'a']]);
  });

  it('ne réécrit pas ce qui a déjà été écrit', () => {
    const { writer, written, frame } = rig();
    writer.append('s', 'a');
    writer.flush();
    frame();
    expect(written).toEqual([['s', 'a']]);
  });

  it('reprend normalement après un flush', () => {
    const { writer, written, frame } = rig();
    writer.append('s', 'a');
    writer.flush();
    writer.append('s', 'b');
    frame();
    expect(written).toEqual([
      ['s', 'a'],
      ['s', 'b'],
    ]);
  });

  it('jette le travail en attente au démontage', () => {
    const { writer, written, frame } = rig();
    writer.append('s', 'a');
    writer.dispose();
    frame();
    expect(written).toEqual([]);
  });
});
