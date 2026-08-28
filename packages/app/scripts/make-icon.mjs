/**
 * Builds `resources/icon.ico` from `resources/icon-512.png`.
 *
 *   node scripts/make-icon.mjs
 *
 * Three choices, each paid for with a mistake.
 *
 * 1. The source is the PNG, not the SVG. The mascot's SVG sets the face in
 *    TEXT (`font-family: Georgia, serif`): its rendering depends on the fonts
 *    installed, so the icon wouldn't look the same from one machine to
 *    another. The 512 PNG is the canonical artwork — the same one as the
 *    favicon of apartejs.dev and of monaparte.
 *
 * 2. We don't rasterize by hand. The first version of this .ico had been
 *    written pixel by pixel: the parentheses' arcs came out beveled and the
 *    apostrophes as a horizontal bar — a shape people mistook for another
 *    framework's logo. Here, reduction by AREA AVERAGING: each target pixel
 *    is the exact average of the source rectangle it covers, fractional
 *    edges included. This is what keeps the mascot's thin strokes legible at
 *    16 px.
 *
 * 3. Zero dependencies and zero browser. Node already knows how to do
 *    everything: `zlib` decompresses and recompresses the PNG, the rest is
 *    arithmetic. Going through Chromium to resize an image cost us a browser
 *    download, then a stuck Electron process — for a forty-line operation.
 *
 * Also writes `resources/icon-preview.png`: the sheet of small sizes,
 * enlarged pixel by pixel, to check by eye what Windows will display.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const RESOURCES = join(import.meta.dirname, '..', 'resources');

/**
 * Sizes baked into the file.
 *
 * Windows doesn't resize gracefully: it picks the nearest entry. Without
 * 256, the Alt-Tab and "large icons" icon is a blurry interpolation of the
 * 48; without 20/24/40, it's the taskbars at 125%, 150%, and 250% that are.
 * So we bake in the whole usual scale.
 */
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

/** Above this threshold, entries are PNGs — otherwise BMPs. */
const PNG_FROM = 64;

/**
 * Corner radius, as a fraction of the side — the artwork's own (112/512).
 *
 * The source is RGB without alpha: its corners are WHITE, which would give
 * four bright blotches on a dark taskbar. So we recompute the mask
 * ourselves, which cuts them out exactly.
 */
const CORNER_RADIUS = 112 / 512;

/** Backdrop of the mark, placed under the cut corners to avoid any light halo. */
const BACKDROP = [23, 20, 28];

// ── PNG ────────────────────────────────────────────────────────────────────

function chunk(type, payload) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), payload])), 0);
  return Buffer.concat([head, payload, crc]);
}

/** 8-bit RGBA PNG, no filter — compression does the rest. */
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // depth
  header[9] = 6; // truecolor + alpha
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter "none"
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Decodes an 8-bit PNG, RGB or RGBA, non-interlaced — what the artwork's
 * exports produce. Everything else is loudly rejected: a clear message beats
 * a silently wrong icon.
 */
function decodePng(file) {
  let offset = 8;
  let header = null;
  const parts = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    const payload = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = payload;
    if (type === 'IDAT') parts.push(payload);
    offset += 12 + length;
  }
  if (!header) throw new Error('PNG without IHDR');

  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const depth = header[8];
  const colorType = header[9];
  const interlace = header[12];
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(
      `Unsupported PNG: depth ${depth}, type ${colorType}, interlace ${interlace}`,
    );
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(parts));
  const pixels = Buffer.alloc(stride * height);

  // Unfiltering: each line is read relative to its left neighbor and the one
  // above (PNG spec, § 9.2). Without this, the image comes out gradient-smeared.
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[from + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft =
        y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let previous = 0;
      if (filter === 1) previous = left;
      else if (filter === 2) previous = up;
      else if (filter === 3) previous = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const dLeft = Math.abs(estimate - left);
        const dUp = Math.abs(estimate - up);
        const dUpLeft = Math.abs(estimate - upLeft);
        previous = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
      }
      pixels[y * stride + x] = (value + previous) & 0xff;
    }
  }

  // Normalizing to RGBA: the rest of the script no longer has to worry about it.
  if (channels === 4) return { width, height, rgba: pixels };
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
    rgba[j] = pixels[i];
    rgba[j + 1] = pixels[i + 1];
    rgba[j + 2] = pixels[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, rgba };
}

// ── Image ──────────────────────────────────────────────────────────────────

/**
 * Cuts the rounded corners by computing the COVERAGE of each pixel.
 *
 * An "inside / outside" test would give staircase edges. So we sample 4×4
 * points per pixel: alpha becomes the proportion actually covered, and the
 * edge is smooth. Pixels outside the shape receive the mark's backdrop, so
 * that a later downscale doesn't bring white back up.
 */
function roundCorners(size, rgba) {
  const radius = size * CORNER_RADIUS;
  const inside = (x, y) => {
    // Distance to the nearest corner, in the fillet's coordinate frame.
    const dx = Math.max(radius - x, x - (size - radius), 0);
    const dy = Math.max(radius - y, y - (size - radius), 0);
    return dx * dx + dy * dy <= radius * radius;
  };

  const out = Buffer.from(rgba);
  const steps = 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < steps; sy += 1) {
        for (let sx = 0; sx < steps; sx += 1) {
          if (inside(x + (sx + 0.5) / steps, y + (sy + 0.5) / steps)) covered += 1;
        }
      }
      if (covered === steps * steps) continue;
      const at = (y * size + x) * 4;
      if (covered === 0) {
        out[at] = BACKDROP[0];
        out[at + 1] = BACKDROP[1];
        out[at + 2] = BACKDROP[2];
        out[at + 3] = 0;
        continue;
      }
      out[at + 3] = Math.round((rgba[at + 3] * covered) / (steps * steps));
    }
  }
  return out;
}

/**
 * Downscaling by area averaging, in PREMULTIPLIED colors.
 *
 * Premultiplying isn't a fussy nicety: averaging colors without accounting
 * for their opacity brings the color of transparent pixels up into the edge
 * — a light fringe all around the icon.
 */
function resize(source, from, to) {
  const out = Buffer.alloc(to * to * 4);
  const ratio = from / to;
  for (let y = 0; y < to; y += 1) {
    const y0 = y * ratio;
    const y1 = (y + 1) * ratio;
    for (let x = 0; x < to; x += 1) {
      const x0 = x * ratio;
      const x1 = (x + 1) * ratio;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weight = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy += 1) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx += 1) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          const w = wx * wy;
          const at = (sy * from + sx) * 4;
          const alpha = source[at + 3] / 255;
          r += source[at] * alpha * w;
          g += source[at + 1] * alpha * w;
          b += source[at + 2] * alpha * w;
          a += source[at + 3] * w;
          weight += w;
        }
      }
      const at = (y * to + x) * 4;
      const alpha = a / weight / 255;
      out[at] = alpha > 0 ? Math.round(r / weight / alpha) : 0;
      out[at + 1] = alpha > 0 ? Math.round(g / weight / alpha) : 0;
      out[at + 2] = alpha > 0 ? Math.round(b / weight / alpha) : 0;
      out[at + 3] = Math.round(a / weight);
    }
  }
  return out;
}

/**
 * Boosts the stroke for the very small sizes.
 *
 * Downscaling a face to 16 px averages the gold with the background: the
 * stroke turns grayish-brown and barely reads. So we reopen the gap to the
 * background — each pixel moves away from the background color by a given
 * factor, saturation included. This isn't cheating: it's what a designer
 * does by hand when drawing a more contrasted "small size" variant.
 */
function boostContrast(rgba, factor) {
  const out = Buffer.from(rgba);
  for (let i = 0; i < out.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const gap = rgba[i + c] - BACKDROP[c];
      out[i + c] = Math.max(0, Math.min(255, Math.round(BACKDROP[c] + gap * factor)));
    }
  }
  return out;
}

/** Below this size, the stroke is boosted. */
const BOOST_BELOW = 32;
const BOOST_FACTOR = 1.45;

// ── ICO ────────────────────────────────────────────────────────────────────

/**
 * 32-bit DIB for the small sizes.
 *
 * ICO format: height DOUBLED in the header (image + mask), bottom-to-top
 * rows, BGRA channels. The monochrome mask stays at zero — alpha has been
 * enough since Windows XP — but its PLACE must be there, otherwise the file
 * is rejected.
 */
function encodeBmp(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const maskRow = Math.ceil(size / 32) * 4;
  header.writeUInt32LE(size * size * 4 + maskRow * size, 20);

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const source = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x += 1) {
      const from = source + x * 4;
      const to = (y * size + x) * 4;
      pixels[to] = rgba[from + 2];
      pixels[to + 1] = rgba[from + 1];
      pixels[to + 2] = rgba[from];
      pixels[to + 3] = rgba[from + 3];
    }
  }
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

/** Control sheet: the small sizes, enlarged pixel by pixel, side by side. */
function previewSheet(frames) {
  const zoom = 4;
  const gap = 8;
  const shown = frames.filter((frame) => frame.size <= 64);
  const height = 64 * zoom;
  const width = shown.reduce((total, frame) => total + frame.size * zoom + gap, gap);
  const sheet = Buffer.alloc(width * height * 4);
  let x0 = gap;
  for (const { size, rgba } of shown) {
    for (let y = 0; y < size * zoom; y += 1) {
      for (let x = 0; x < size * zoom; x += 1) {
        const from = (Math.floor(y / zoom) * size + Math.floor(x / zoom)) * 4;
        const to = ((y + height - size * zoom) * width + x0 + x) * 4;
        rgba.copy(sheet, to, from, from + 4);
      }
    }
    x0 += size * zoom + gap;
  }
  return encodePng(width, height, sheet);
}

// ── Assembly ───────────────────────────────────────────────────────────────

const source = decodePng(await readFile(join(RESOURCES, 'icon-512.png')));
if (source.width !== source.height) throw new Error('the source must be square');

// The corners are cut AT THE SOURCE, before downscaling: the white
// therefore disappears before it could get averaged with the rest.
const master = roundCorners(source.width, source.rgba);
const frames = SIZES.map((size) => {
  const reduced = size === source.width ? master : resize(master, source.width, size);
  return {
    size,
    rgba: size < BOOST_BELOW ? boostContrast(reduced, BOOST_FACTOR) : reduced,
  };
});

const payloads = frames.map(({ size, rgba }) => ({
  size,
  bytes: size >= PNG_FROM ? encodePng(size, size, rgba) : encodeBmp(size, rgba),
}));

const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(payloads.length, 4);

let offset = 6 + 16 * payloads.length;
const directory = payloads.map(({ size, bytes }) => {
  const entry = Buffer.alloc(16);
  entry[0] = size === 256 ? 0 : size; // 0 means 256: a byte doesn't go further
  entry[1] = size === 256 ? 0 : size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(bytes.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += bytes.length;
  return entry;
});

const ico = Buffer.concat([header, ...directory, ...payloads.map(({ bytes }) => bytes)]);
await writeFile(join(RESOURCES, 'icon.ico'), ico);
await writeFile(join(RESOURCES, 'icon-preview.png'), previewSheet(frames));

console.log(
  `icon.ico — ${payloads.length} sizes (${SIZES.join(', ')}), ${ico.length} bytes`,
);
