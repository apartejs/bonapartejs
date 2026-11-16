/**
 * The icons of the notification area and of the taskbar's badge (task 8.5): the bicorne of the board « Logo »,
 * filled in the colour of each state, drawn without any library into PNGs that are versioned — and that must stay
 * what the tokens give (`node scripts/make-icons.mjs` draws them again).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BICORNE, encodePng, iconSet, outline, readTokens, TRAY_TOKENS } from './draw.js';

const APP = join(import.meta.dirname, '..', '..', '..');
const TOKENS = join(APP, 'src', 'renderer', 'src', 'theme', 'tokens.css');
const ICONS = join(APP, 'resources', 'icons');

/** Reads back a PNG of ours: 8-bit RGBA, every row unfiltered. */
function decode(png: Buffer): { width: number; height: number; raw: Buffer; pixel(x: number, y: number): [number, number, number, number] } {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const chunks: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  return {
    width,
    height,
    raw,
    pixel: (x, y) => {
      const start = y * (width * 4 + 1) + 1 + x * 4;
      return [raw[start]!, raw[start + 1]!, raw[start + 2]!, raw[start + 3]!];
    },
  };
}

const rgb = (hex: string): number[] => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

describe('the icons', () => {
  it('the bicorne is one closed outline, as wide as the board draws it', () => {
    const shapes = outline(BICORNE);
    expect(shapes).toHaveLength(1);
    const xs = shapes[0]!.map(([x]) => x);
    const ys = shapes[0]!.map(([, y]) => y);
    expect(Math.min(...xs)).toBeCloseTo(6, 5);
    expect(Math.max(...xs)).toBeCloseTo(114, 5);
    expect(Math.min(...ys)).toBeGreaterThan(11);
    expect(Math.max(...ys)).toBeLessThanOrEqual(55);
  });

  it('a PNG of the right size, the bicorne in its colour in the middle, nothing in the corners', async () => {
    const tokens = readTokens(await readFile(TOKENS, 'utf8'));
    const set = iconSet(tokens);
    for (const [state, token] of Object.entries(TRAY_TOKENS)) {
      for (const size of [16, 24, 32]) {
        const png = decode(set.get(`tray-${state}-${size}.png`)!);
        expect([png.width, png.height]).toEqual([size, size]);
        const middle = png.pixel(size / 2, Math.round(size * 0.55));
        expect(middle.slice(0, 3)).toEqual(rgb(tokens.get(token)!));
        expect(middle[3]).toBe(255);
        expect(png.pixel(0, 0)[3]).toBe(0);
        expect(png.pixel(size - 1, size - 1)[3]).toBe(0);
      }
    }
    // The badge: a dot, in the colour of what it says.
    const badge = decode(set.get('badge-waiting-16.png')!);
    expect(badge.pixel(8, 8).slice(0, 3)).toEqual(rgb(tokens.get(TRAY_TOKENS.waiting)!));
    expect(badge.pixel(0, 0)[3]).toBe(0);
  });

  it('a PNG is written the same every time: the files are compared byte for byte', () => {
    const pixels = new Uint8Array(4 * 4 * 4).fill(200);
    expect(encodePng(4, 4, pixels).equals(encodePng(4, 4, pixels))).toBe(true);
  });

  it('the icons in the repository are those the tokens give — run `node scripts/make-icons.mjs` after a change', async () => {
    const set = iconSet(readTokens(await readFile(TOKENS, 'utf8')));
    expect(set.size).toBe(16);
    for (const [name, png] of set) {
      // Pixel for pixel: another zlib may compress the same pixels into other bytes.
      const kept = decode(await readFile(join(ICONS, name)));
      const drawn = decode(png);
      expect([kept.width, kept.height], name).toEqual([drawn.width, drawn.height]);
      expect(kept.raw.equals(drawn.raw), name).toBe(true);
    }
  });
});
