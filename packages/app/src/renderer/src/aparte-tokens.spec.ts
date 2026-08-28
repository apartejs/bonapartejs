import libraryStylesheet from '@aparte/core/styles.css?raw';
import { describe, expect, it } from 'vitest';

/**
 * Every `--aparte-*` token OUR sheet reads must exist in the lib's own.
 *
 * The defect this test prevents is silent end to end. `color:
 * var(--aparte-text-primary)` on an undeclared token produces neither an
 * error nor a warning: the declaration becomes invalid at computation time,
 * the property is simply inherited, and the rendering stays almost right. We
 * carried that very name — which never existed — in ten places for months,
 * through several visual reviews.
 *
 * The sheets are read by the BUNDLER (`?raw`), not by `node:fs`: its
 * resolution is the one that's authoritative, the same as the renderer's,
 * including for the lib's `./styles.css` entry point — whose internal path
 * is none of our business and can change.
 */

const ourStylesheets = import.meta.glob<string>('./*.css', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/** Tokens read WITHOUT a fallback — the only ones that require a declaration. */
function tokensReadWithoutFallback(css: string): string[] {
  return [...css.matchAll(/var\(\s*(--aparte-[a-z0-9-]+)\s*\)/g)].map((m) => m[1] as string);
}

/** Tokens read WITH a fallback — suspect in the other direction (see below). */
function tokensReadWithFallback(css: string): string[] {
  return [...css.matchAll(/var\(\s*(--aparte-[a-z0-9-]+)\s*,/g)].map((m) => m[1] as string);
}

function tokensDeclared(css: string): Set<string> {
  return new Set([...css.matchAll(/(--aparte-[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string));
}

describe('theme tokens read by bonaparte', () => {
  const declared = tokensDeclared(libraryStylesheet);
  const sheets = Object.entries(ourStylesheets);

  it('both sheets are indeed the ones we think they are', () => {
    // Anchors: without them, an empty sheet would make the next two tests
    // pass vacuously — exactly the failure mode this file exists to make
    // impossible.
    expect(declared.size).toBeGreaterThan(100);
    expect(declared.has('--aparte-text')).toBe(true);
    expect(sheets.length).toBeGreaterThan(2);
  });

  it('every token read without a fallback is declared by the lib', () => {
    const missing = sheets.flatMap(([file, css]) =>
      tokensReadWithoutFallback(css)
        .filter((token) => !declared.has(token))
        .map((token) => `${file} reads ${token}, which the lib doesn't declare`),
    );

    expect([...new Set(missing)]).toEqual([]);
  });

  it('no fallback on a token the lib declares', () => {
    // A fallback applies ONLY if the token is missing. On a declared token,
    // it therefore never kicks in — it just lives alongside it, and drifts:
    // we were carrying `var(--aparte-error, #c0392b)`, a second red kept in
    // reserve that would only have taken over the day the lib removed its
    // own. This is the cleanup the lib did on itself in 0.13.0 (471 fallbacks
    // removed, 155 of which contradicted the declared value).
    const useless = sheets.flatMap(([file, css]) =>
      tokensReadWithFallback(css)
        .filter((token) => declared.has(token))
        .map((token) => `${file} puts a fallback on ${token}, which the lib declares`),
    );

    expect([...new Set(useless)]).toEqual([]);
  });
});
