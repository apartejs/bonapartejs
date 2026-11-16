/**
 * The icons of the notification area and of the taskbar's badge (task 8.5, board « Notifications et zone de
 * notification »; plan, decision 4 of phase 8): the bicorne of the board « Logo », filled in one colour per state,
 * and a dot for the badge — read from the tokens, drawn without any library, written as PNGs (16, 24 and 32 px,
 * for the scales of a screen). `scripts/make-icons.mjs` writes them into `resources/icons/`, where the main
 * process reads them; a test checks they are still what the tokens give.
 *
 * Plain TypeScript Node runs as it is (types only): the script imports this file directly.
 */

import { deflateSync } from 'node:zlib';

/** The bicorne, as the board « Logo » draws it (its viewBox: 0 8 120 52). */
export const BICORNE = 'M6 48C22 44 30 13 60 12C90 13 98 44 114 48C96 51 80 55 60 55C40 55 24 51 6 48Z';

/** The token of each state of the icon, in `tokens.css`. */
export const TRAY_TOKENS = {
  rest: '--bonaparte-tray-rest',
  waiting: '--bonaparte-tray-waiting',
  failure: '--bonaparte-tray-failure',
  asleep: '--bonaparte-tray-asleep',
} as const;

/** The badge says what waits, or a failure. */
const BADGES = { waiting: TRAY_TOKENS.waiting, failure: TRAY_TOKENS.failure } as const;

export type Point = [number, number];
type Rgb = [number, number, number];

/** The outlines of a path of absolute M, L, C and Z commands, each curve cut into `steps` segments. */
export function outline(d: string, steps = 24): Point[][] {
  const tokens = d.match(/[a-z]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const shapes: Point[][] = [];
  let shape: Point[] = [];
  let at: Point = [0, 0];
  let command = '';
  let i = 0;
  const num = (): number => {
    const token = tokens[i++];
    if (token === undefined || /^[a-z]$/i.test(token)) throw new Error(`A number was expected in the path, at ${i}`);
    return Number(token);
  };
  const close = (): void => {
    if (shape.length > 2) shapes.push(shape);
    shape = [];
  };
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i]!)) command = tokens[i++]!;
    switch (command) {
      case 'M':
        close();
        at = [num(), num()];
        shape = [at];
        // More pairs after a move are lines.
        command = 'L';
        break;
      case 'L':
        at = [num(), num()];
        shape.push(at);
        break;
      case 'C': {
        const from = at;
        const one: Point = [num(), num()];
        const two: Point = [num(), num()];
        const to: Point = [num(), num()];
        for (let step = 1; step <= steps; step += 1) {
          const t = step / steps;
          const u = 1 - t;
          const weights = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
          shape.push([
            weights[0] * from[0] + weights[1] * one[0] + weights[2] * two[0] + weights[3] * to[0],
            weights[0] * from[1] + weights[1] * one[1] + weights[2] * two[1] + weights[3] * to[1],
          ]);
        }
        at = to;
        break;
      }
      case 'Z':
        close();
        command = '';
        break;
      default:
        throw new Error(`The icons draw only absolute M, L, C and Z, not « ${command} »`);
    }
  }
  close();
  return shapes;
}

/** Where the outlines cross the horizontal line `y`: the x of each crossing. */
function crossings(shapes: readonly Point[][], y: number): number[] {
  const found: number[] = [];
  for (const shape of shapes) {
    for (let a = 0, b = shape.length - 1; a < shape.length; b = a++) {
      const [ax, ay] = shape[a]!;
      const [bx, by] = shape[b]!;
      if (ay > y !== by > y) found.push(((bx - ax) * (y - ay)) / (by - ay) + ax);
    }
  }
  return found;
}

/** Samples per pixel, on each axis: the edges are smooth. */
const SAMPLES = 8;

/** Fills `size`×`size` pixels: each pixel's alpha is the share of its samples `colour` paints, its colour their mean. */
function paint(size: number, colour: (x: number, y: number) => Rgb | null): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let count = 0;
      let last: Rgb | null = null;
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const sample = colour(px + (sx + 0.5) / SAMPLES, py + (sy + 0.5) / SAMPLES);
          if (!sample) continue;
          count += 1;
          last = sample;
          for (let c = 0; c < 3; c += 1) sum[c]! += sample[c]!;
        }
      }
      if (count === 0 || !last) continue;
      const at = (py * size + px) * 4;
      for (let c = 0; c < 3; c += 1) pixels[at + c] = Math.round(sum[c]! / count);
      pixels[at + 3] = Math.round((255 * count) / (SAMPLES * SAMPLES));
    }
  }
  return pixels;
}

/** The outlines, centred, as large as `size` holds with a margin, in one colour. */
export function fill(shapes: readonly Point[][], size: number, rgb: Rgb): Uint8Array {
  const points = shapes.flat();
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const margin = size / 16;
  const scale = (size - 2 * margin) / Math.max(maxX - minX, maxY - minY);
  const left = (size - (maxX - minX) * scale) / 2;
  const top = (size - (maxY - minY) * scale) / 2;
  // Even-odd, one row of samples at a time: a sample is inside when an odd number of crossings lie to its right.
  const rows = new Map<number, number[]>();
  return paint(size, (x, y) => {
    const row = Math.floor(y * SAMPLES);
    let across = rows.get(row);
    if (!across) {
      across = crossings(shapes, (y - top) / scale + minY).map((at) => (at - minX) * scale + left);
      rows.set(row, across);
    }
    let right = 0;
    for (const at of across) if (at > x) right += 1;
    return right % 2 === 1 ? rgb : null;
  });
}

/** The badge: a dot of `rgb` in a white ring, which keeps it apart from the app's icon under it. */
export function dot(size: number, rgb: Rgb): Uint8Array {
  const centre = size / 2;
  const outer = size / 2 - size / 32;
  const inner = outer - size / 8;
  return paint(size, (x, y) => {
    const distance = Math.hypot(x - centre, y - centre);
    if (distance > outer) return null;
    return distance > inner ? [255, 255, 255] : rgb;
  });
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** A PNG of 8-bit RGBA pixels, each row unfiltered. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** The colours `tokens.css` declares for the light theme (its first `:root` block). */
export function readTokens(css: string): Map<string, string> {
  const open = css.indexOf(':root {');
  const block = css.slice(open, css.indexOf('}', open));
  return new Map([...block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)].map((found) => [found[1]!, found[2]!.toUpperCase()]));
}

const rgbOf = (tokens: ReadonlyMap<string, string>, name: string): Rgb => {
  const hex = tokens.get(name);
  if (!hex) throw new Error(`The token ${name} is not declared in tokens.css`);
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as Rgb;
};

/** Every icon, by its file name: `tray-<state>-<size>.png` and `badge-<kind>-<size>.png`. */
export function iconSet(tokens: ReadonlyMap<string, string>): Map<string, Buffer> {
  const set = new Map<string, Buffer>();
  const hat = outline(BICORNE);
  for (const [state, token] of Object.entries(TRAY_TOKENS)) {
    for (const size of [16, 24, 32]) set.set(`tray-${state}-${size}.png`, encodePng(size, size, fill(hat, size, rgbOf(tokens, token))));
  }
  for (const [kind, token] of Object.entries(BADGES)) {
    for (const size of [16, 32]) set.set(`badge-${kind}-${size}.png`, encodePng(size, size, dot(size, rgbOf(tokens, token))));
  }
  return set;
}
