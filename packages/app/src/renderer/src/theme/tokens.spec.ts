/**
 * Every colour of the app is a token, declared once, for light and for dark,
 * in `tokens.css`. No screen writes a colour of its own: a screen that did
 * would stay light in the dark theme, or keep the old accent.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const tokensFile = join(here, 'tokens.css');
const rendererSrc = join(here, '..');
const repository = join(here, '..', '..', '..', '..', '..', '..');

/** The declarations of the first block whose selector contains `selector`. */
function block(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  expect(start, `no block for ${selector}`).not.toBe(-1);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const declarations = new Map<string, string>();
  for (const line of css.slice(open + 1, close).split(';')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    declarations.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return declarations;
}

/** WCAG relative luminance of `#RRGGBB`. */
function luminance(hex: string): number {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

// Comments are prose: they may hold a colon or a selector, and are not declarations.
const css = readFileSync(tokensFile, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const themes = { light: block(css, ':root'), dark: block(css, "[data-aparte-theme='dark']") };

/** aparté's eight base colours, and its four state colours. */
const required = [
  '--aparte-primary',
  '--aparte-primary-hover',
  '--aparte-bg',
  '--aparte-surface-1',
  '--aparte-surface-2',
  '--aparte-text',
  '--aparte-text-muted',
  '--aparte-border',
  '--aparte-success',
  '--aparte-warning',
  '--aparte-error',
  '--aparte-info',
];

describe('the design tokens', () => {
  for (const [name, tokens] of Object.entries(themes)) {
    it(`declares every base colour for the ${name} theme`, () => {
      for (const token of required) expect(tokens.get(token), `${token} (${name})`).toBeTruthy();
    });

    it(`keeps text readable on every background of the ${name} theme (4.5:1)`, () => {
      for (const text of ['--aparte-text', '--aparte-text-muted']) {
        for (const background of ['--aparte-bg', '--aparte-surface-1', '--aparte-surface-2']) {
          const ratio = contrast(tokens.get(text)!, tokens.get(background)!);
          expect(ratio, `${text} on ${background} (${name})`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  it('uses the design-system values for the light theme', () => {
    expect(themes.light.get('--bonaparte-accent')).toBe('#087EA4');
    expect(themes.light.get('--aparte-bg')).toBe('#FFFFFF');
    expect(themes.light.get('--aparte-text')).toBe('#1D1D1B');
    expect(themes.dark.get('--aparte-bg')).toBe('#161615');
    expect(themes.dark.get('--aparte-text')).toBe('#EDEDE8');
  });

  it('offers the four accents', () => {
    for (const accent of ['teal', 'violet', 'orange']) {
      expect(block(css, `[data-bonaparte-accent='${accent}']`).get('--bonaparte-accent')).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe('colours outside the tokens file', () => {
  // Never glued to a word or a slash: that is the number of an issue (`owner/repo#205`).
  const hexColour = /(?<![\w/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
  const sources = new Set(['.ts', '.tsx', '.css', '.html']);

  it('tells a colour from the number of an issue', () => {
    expect(hexColour.test('color: #fff;')).toBe(true);
    expect(hexColour.test("fill='#0F766E'")).toBe(true);
    // A comment that names the issue a workaround waits for is not a colour.
    expect(hexColour.test('see apartejs/aparte#205')).toBe(false);
  });

  function sourceFiles(dir: string): string[] {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return [];
    }
    return entries.flatMap((entry) => {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'out') return [];
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return sources.has(extname(path)) && !path.endsWith('.spec.ts') && !path.endsWith('.spec.tsx') ? [path] : [];
    });
  }

  it('there is none, in the window or in a plugin view', () => {
    const files = [...sourceFiles(join(rendererSrc, '..')), ...sourceFiles(join(repository, 'plugins'))];
    expect(files.length).toBeGreaterThan(0);
    const offenders = files
      .filter((file) => file !== tokensFile)
      .filter((file) => hexColour.test(readFileSync(file, 'utf8')))
      .map((file) => relative(repository, file));
    expect(offenders).toEqual([]);
  });
});

describe('the tokens a rule reads', () => {
  const appDir = join(here, '..', '..', '..', '..');

  /** Every `--aparte-*` and `--bonaparte-*` name declared in `text`. */
  function declared(text: string): Set<string> {
    return new Set([...text.matchAll(/(--(?:aparte|bonaparte)-[\w-]+)\s*:/g)].map((match) => match[1]!));
  }

  function files(dir: string, keep: (path: string) => boolean): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : files(path, keep);
      return keep(path) ? [path] : [];
    });
  }

  it('is declared, by aparté or by the tokens file — an undeclared one paints nothing, silently', () => {
    const aparte = join(appDir, 'node_modules', '@aparte');
    const known = new Set<string>();
    for (const name of readdirSync(aparte)) {
      const dist = join(aparte, name, 'dist');
      try {
        statSync(dist);
      } catch {
        continue;
      }
      for (const file of files(dist, (path) => /\.(css|js)$/.test(path))) {
        for (const token of declared(readFileSync(file, 'utf8'))) known.add(token);
      }
    }
    expect(known.has('--aparte-error-surface')).toBe(true);
    const sources = files(rendererSrc, (path) => /\.(css|tsx?)$/.test(path) && !/\.spec\.tsx?$/.test(path));
    for (const file of sources) for (const token of declared(readFileSync(file, 'utf8'))) known.add(token);
    const unknown = new Set<string>();
    for (const file of sources) {
      for (const match of readFileSync(file, 'utf8').matchAll(/var\((--(?:aparte|bonaparte)-[\w-]+)\s*[,)]/g)) {
        if (!known.has(match[1]!)) unknown.add(`${relative(appDir, file)}: ${match[1]}`);
      }
    }
    expect([...unknown]).toEqual([]);
    // It reads every file aparté ships: seconds on a loaded machine (the whole suite runs beside it).
  }, 30_000);
});
