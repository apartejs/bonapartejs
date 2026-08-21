/**
 * Fabrique `resources/icon.ico` à partir de `resources/icon-512.png`.
 *
 *   node scripts/make-icon.mjs
 *
 * Trois choix, chacun payé d'une erreur.
 *
 * 1. La source est le PNG, pas le SVG. Le SVG de la mascotte pose la frimousse
 *    en TEXTE (`font-family: Georgia, serif`) : son rendu dépend des polices
 *    installées, l'icône ne serait donc pas la même d'une machine à l'autre.
 *    Le PNG 512 est l'artwork canonique — celui du favicon d'apartejs.dev et
 *    de monaparte.
 *
 * 2. On ne rasterise pas à la main. La première version de ce .ico avait été
 *    écrite pixel par pixel : les arcs des parenthèses en sortaient en biseaux
 *    et les apostrophes en barre horizontale — une forme qu'on prenait pour le
 *    logo d'un autre framework. Ici, réduction par MOYENNE D'AIRE : chaque
 *    pixel cible est la moyenne exacte du rectangle source qu'il couvre, bords
 *    fractionnaires compris. C'est ce qui garde lisibles les traits fins de la
 *    mascotte en 16 px.
 *
 * 3. Zéro dépendance et zéro navigateur. Node sait déjà tout faire : `zlib`
 *    décompresse et recompresse le PNG, le reste est de l'arithmétique. Passer
 *    par Chromium pour redimensionner une image nous a coûté un téléchargement
 *    de navigateur, puis un processus Electron bloqué — pour une opération de
 *    quarante lignes.
 *
 * Écrit aussi `resources/icon-preview.png` : la planche des petites tailles,
 * agrandies au pixel, pour vérifier de l'œil ce que Windows affichera.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const RESOURCES = join(import.meta.dirname, '..', 'resources');

/**
 * Tailles gravées dans le fichier.
 *
 * Windows ne redimensionne pas gracieusement : il choisit l'entrée la plus
 * proche. Sans 256, l'icône d'Alt-Tab et des « grandes icônes » est une
 * interpolation floue du 48 ; sans 20/24/40, ce sont les barres des tâches à
 * 125 %, 150 % et 250 % qui le sont. On grave donc toute l'échelle usuelle.
 */
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

/** Au-delà de ce seuil, les entrées sont des PNG — sinon des BMP. */
const PNG_FROM = 64;

/**
 * Rayon des coins, en fraction du côté — celui de l'artwork (112/512).
 *
 * La source est en RVB sans alpha : ses coins sont BLANCS, ce qui donnerait
 * quatre taches claires sur une barre des tâches sombre. On recalcule donc le
 * masque nous-mêmes, ce qui les découpe exactement.
 */
const CORNER_RADIUS = 112 / 512;

/** Fond de la marque, posé sous les coins découpés pour éviter tout halo clair. */
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

/** PNG 8 bits RGBA, sans filtre — la compression fait le reste. */
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // profondeur
  header[9] = 6; // couleur vraie + alpha
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filtre « aucun »
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
 * Décode un PNG 8 bits, RVB ou RVBA, non entrelacé — ce que produisent les
 * exports de l'artwork. Tout le reste est refusé bruyamment : mieux vaut un
 * message clair qu'une icône silencieusement fausse.
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
  if (!header) throw new Error('PNG sans IHDR');

  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const depth = header[8];
  const colorType = header[9];
  const interlace = header[12];
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(
      `PNG non pris en charge : profondeur ${depth}, type ${colorType}, entrelacement ${interlace}`,
    );
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(parts));
  const pixels = Buffer.alloc(stride * height);

  // Défiltrage : chaque ligne se lit relativement à sa voisine de gauche et à
  // celle du dessus (spec PNG, § 9.2). Sans ça, l'image sort en dégradés.
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

  // Uniformisation en RVBA : le reste du script n'a plus à s'en soucier.
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
 * Découpe les coins arrondis en calculant la COUVERTURE de chaque pixel.
 *
 * Un test « dedans / dehors » donnerait des marches d'escalier. On échantillonne
 * donc 4×4 points par pixel : l'alpha devient la proportion réellement couverte,
 * et le bord est lisse. Les pixels hors forme reçoivent le fond de la marque,
 * pour qu'une réduction ultérieure ne fasse pas remonter de blanc.
 */
function roundCorners(size, rgba) {
  const radius = size * CORNER_RADIUS;
  const inside = (x, y) => {
    // Distance au coin le plus proche, dans le repère du congé.
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
 * Réduction par moyenne d'aire, en couleurs PRÉMULTIPLIÉES.
 *
 * Prémultiplier n'est pas une coquetterie : moyenner des couleurs sans tenir
 * compte de leur opacité fait remonter la couleur des pixels transparents dans
 * le bord — un liseré clair tout autour de l'icône.
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
 * Renforce le trait pour les toutes petites tailles.
 *
 * Réduire une frimousse à 16 px moyenne l'or avec le fond : le trait devient
 * gris-brun et se lit à peine. On rouvre donc l'écart au fond — chaque pixel
 * s'éloigne de la couleur de fond d'un facteur donné, saturation comprise.
 * Ce n'est pas de la triche : c'est ce qu'un graphiste fait à la main en
 * dessinant une variante « petite taille » plus contrastée.
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

/** En-dessous de cette taille, le trait est renforcé. */
const BOOST_BELOW = 32;
const BOOST_FACTOR = 1.45;

// ── ICO ────────────────────────────────────────────────────────────────────

/**
 * DIB 32 bits pour les petites tailles.
 *
 * Format ICO : hauteur DOUBLÉE dans l'en-tête (image + masque), lignes de bas
 * en haut, canaux en BGRA. Le masque monochrome reste à zéro — l'alpha suffit
 * depuis Windows XP — mais sa PLACE doit être là, sinon le fichier est rejeté.
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

/** Planche de contrôle : les petites tailles, agrandies au pixel, côte à côte. */
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

// ── Assemblage ─────────────────────────────────────────────────────────────

const source = decodePng(await readFile(join(RESOURCES, 'icon-512.png')));
if (source.width !== source.height) throw new Error('la source doit être carrée');

// Les coins sont découpés À LA SOURCE, avant réduction : le blanc disparaît
// donc avant d'avoir pu se moyenner avec le reste.
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
  entry[0] = size === 256 ? 0 : size; // 0 veut dire 256 : un octet ne va pas plus loin
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
  `icon.ico — ${payloads.length} tailles (${SIZES.join(', ')}), ${ico.length} octets`,
);
