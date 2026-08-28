import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { electronNeedsDownload, resolveAppDir } from './launch.js';

describe('electronNeedsDownload', () => {
  // The `electron` package no longer downloads its binary at install time:
  // the first `require('electron')` does. That is ~110 MB paid once, and
  // the product rule says a cost is announced before it is paid.
  const electronDir = join('C:', 'proj', 'node_modules', 'electron');

  it('is true when the package has no path.txt yet', () => {
    expect(electronNeedsDownload(electronDir, () => null, () => false)).toBe(true);
  });

  it('is true when path.txt names a binary that is not there', () => {
    expect(electronNeedsDownload(electronDir, () => 'electron.exe', () => false)).toBe(true);
  });

  it('is false once the binary named by path.txt exists', () => {
    const binary = join(electronDir, 'dist', 'electron.exe');
    expect(
      electronNeedsDownload(electronDir, () => 'electron.exe', (p) => p === binary),
    ).toBe(false);
  });
});

const root = join('C:', 'somewhere', 'bonaparte-cli');
const built = (dir: string): string[] => [
  join(dir, 'package.json'),
  join(dir, 'out', 'main', 'index.js'),
];

describe('resolveAppDir', () => {
  it('prefers the app assembled inside the package — the published layout', () => {
    const shipped = join(root, 'app');
    const files = new Set([...built(shipped), ...built(join(root, '..', 'app'))]);
    expect(resolveAppDir(root, (p) => files.has(p))).toBe(shipped);
  });

  it('falls back to the sibling app package of the monorepo', () => {
    const sibling = join(root, '..', 'app');
    const files = new Set(built(sibling));
    expect(resolveAppDir(root, (p) => files.has(p))).toBe(sibling);
  });

  it('ignores an app directory that has not been built', () => {
    // A package.json without out/main/index.js is a source tree, not a
    // launchable app: saying so beats letting Electron fail on a missing main.
    const files = new Set([join(root, 'app', 'package.json')]);
    expect(resolveAppDir(root, (p) => files.has(p))).toBeNull();
  });
});
