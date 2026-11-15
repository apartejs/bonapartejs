/**
 * The questions the main process answers before it does anything for a page:
 * "is this one of our pages?", "is this the page the window lives on?",
 * "which file of the app is this path?" and "is there a dev server to load?".
 * The first and the third were holes in v0's security audit.
 */

import { posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPermissionAllowed, devServerUrlFrom, isOwnPage, isTrustedOrigin, resolveAppFile } from './security.js';

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

describe('isOwnPage', () => {
  const page = 'bonaparte://app/index.html';

  it('knows the page the window lives on, whatever its fragment', () => {
    expect(isOwnPage('bonaparte://app/index.html', page)).toBe(true);
    expect(isOwnPage('bonaparte://app/index.html#top', page)).toBe(true);
  });

  it('is not another path of the app: a link in a reply must not replace the conversation', () => {
    const others = [
      'bonaparte://app/',
      'bonaparte://app/package.json',
      'bonaparte://app/agent/c/1',
      'bonaparte://app/index.html?x=1',
      'bonaparte://app/assets/index.js',
      'https://example.com/index.html',
      'bonaparte://evil/index.html',
      'not a url',
      '',
    ];
    for (const url of others) expect(isOwnPage(url, page), url).toBe(false);
  });

  it('knows the page the dev server serves, and only that one', () => {
    const dev = 'http://localhost:5173';
    expect(isOwnPage('http://localhost:5173/', dev)).toBe(true);
    expect(isOwnPage('http://localhost:5173/src/main.tsx', dev)).toBe(false);
    expect(isOwnPage('http://localhost:5174/', dev)).toBe(false);
  });
});

describe('devServerUrlFrom', () => {
  const env = { ELECTRON_RENDERER_URL: 'http://localhost:5173' };

  it('is the dev server electron-vite names, in development', () => {
    expect(devServerUrlFrom(env, false)).toBe('http://localhost:5173');
    expect(devServerUrlFrom({ ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173/' }, false)).toBe(
      'http://127.0.0.1:5173/',
    );
  });

  it('is nothing in a packaged app, whatever the environment says', () => {
    expect(devServerUrlFrom(env, true)).toBeUndefined();
  });

  it('is nothing when the variable is absent or empty', () => {
    expect(devServerUrlFrom({}, false)).toBeUndefined();
    expect(devServerUrlFrom({ ELECTRON_RENDERER_URL: '' }, false)).toBeUndefined();
  });

  it('is never a server on another machine', () => {
    const elsewhere = [
      'https://example.com/',
      'http://192.168.1.10:5173/',
      'http://localhost.evil.example:5173/',
      'file:///C:/x/index.html',
      'not a url',
    ];
    for (const url of elsewhere) {
      expect(devServerUrlFrom({ ELECTRON_RENDERER_URL: url }, false), url).toBeUndefined();
    }
  });
});

// Both flavours on every machine: CI runs on Ubuntu and on Windows, and a
// backslash is a separator on one and an ordinary character on the other.
describe.each([
  { flavour: 'Windows paths', paths: win32, root: 'C:\\app\\out\\renderer' },
  { flavour: 'POSIX paths', paths: posix, root: '/app/out/renderer' },
])('resolveAppFile, with $flavour', ({ paths, root }) => {
  const file = (...parts: string[]): string => paths.join(root, ...parts);

  it('serves index.html at the root', () => {
    expect(resolveAppFile(root, '/', paths)).toBe(file('index.html'));
    expect(resolveAppFile(root, '/index.html', paths)).toBe(file('index.html'));
  });

  it('serves a file of the window by its path', () => {
    expect(resolveAppFile(root, '/assets/index-abc123.js', paths)).toBe(file('assets', 'index-abc123.js'));
    expect(resolveAppFile(root, '/assets/a%20b.css', paths)).toBe(file('assets', 'a b.css'));
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
    for (const path of escapes) expect(resolveAppFile(root, path, paths), path).toBeNull();
  });

  it('refuses a backslash wherever it stands: no path of the app has one', () => {
    expect(resolveAppFile(root, '/assets/a\\b.css', paths)).toBeNull();
    expect(resolveAppFile(root, '/assets%5cindex.js', paths)).toBeNull();
  });

  it('refuses a path it cannot decode, or one with a NUL', () => {
    expect(resolveAppFile(root, '/%E0%A4%A', paths)).toBeNull();
    expect(resolveAppFile(root, '/a%00b', paths)).toBeNull();
  });
});

describe('the permissions of the page', () => {
  it('grants the clipboard write, and nothing else', () => {
    expect(isPermissionAllowed('clipboard-sanitized-write')).toBe(true);
    for (const permission of ['media', 'notifications', 'geolocation', 'clipboard-read', 'midi', 'openExternal']) {
      expect(isPermissionAllowed(permission)).toBe(false);
    }
  });
});

