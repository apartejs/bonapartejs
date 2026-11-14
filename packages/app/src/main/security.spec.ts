/**
 * Two questions the main process answers before it does anything for a page:
 * "is this one of our pages?" and "which file of the app is this path?".
 * Both were holes in v0's security audit.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isTrustedOrigin, resolveAppFile } from './security.js';

describe('isTrustedOrigin', () => {
  it('trusts the pages of the app', () => {
    expect(isTrustedOrigin('bonaparte://app/index.html')).toBe(true);
    expect(isTrustedOrigin('bonaparte://app/')).toBe(true);
  });

  it('trusts nothing else', () => {
    const others = [
      'https://example.com/',
      'bonaparte://evil/index.html',
      'bonaparte-plugin://app/index.html',
      'file:///C:/x/index.html',
      'about:blank',
      'not a url',
      '',
    ];
    for (const url of others) expect(isTrustedOrigin(url), url).toBe(false);
  });

  it('trusts the dev server only when one is configured, and only its origin', () => {
    const dev = 'http://localhost:5173/';
    expect(isTrustedOrigin('http://localhost:5173/index.html')).toBe(false);
    expect(isTrustedOrigin('http://localhost:5173/index.html', dev)).toBe(true);
    expect(isTrustedOrigin('http://localhost:5174/', dev)).toBe(false);
    expect(isTrustedOrigin('https://localhost:5173/', dev)).toBe(false);
    expect(isTrustedOrigin('http://localhost.evil.example:5173/', dev)).toBe(false);
  });
});

describe('resolveAppFile', () => {
  const root = join('C:', 'app', 'out', 'renderer');

  it('serves index.html at the root', () => {
    expect(resolveAppFile(root, '/')).toBe(join(root, 'index.html'));
    expect(resolveAppFile(root, '/index.html')).toBe(join(root, 'index.html'));
  });

  it('serves a file of the window by its path', () => {
    expect(resolveAppFile(root, '/assets/index-abc123.js')).toBe(join(root, 'assets', 'index-abc123.js'));
    expect(resolveAppFile(root, '/assets/a%20b.css')).toBe(join(root, 'assets', 'a b.css'));
  });

  it('never leaves the folder of the window', () => {
    const escapes = [
      '/../main/index.js',
      '/assets/../../main/index.js',
      '/%2e%2e/main/index.js',
      '/..%2fmain/index.js',
      '/..%5cmain%5cindex.js',
      '/assets/..\\..\\main\\index.js',
    ];
    for (const path of escapes) expect(resolveAppFile(root, path), path).toBeNull();
  });

  it('refuses a path it cannot decode, or one with a NUL', () => {
    expect(resolveAppFile(root, '/%E0%A4%A')).toBeNull();
    expect(resolveAppFile(root, '/a%00b')).toBeNull();
  });
});
