/**
 * A tone of the kit's alert that the kit does not have draws nothing — « aparte-alert--error » left a failure card
 * the colour of a note (task 12.5, seen on the screenshots). Every one the window writes is one the kit defines.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const kitDir = join(dirname(createRequire(import.meta.url).resolve('@aparte/core/package.json')), 'dist');
const kit = readdirSync(kitDir)
  .filter((name) => name.endsWith('.css'))
  .map((name) => readFileSync(join(kitDir, name), 'utf8'))
  .join('\n');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('the kit’s alert tones', () => {
  it('are only those the kit defines', () => {
    const unknown: string[] = [];
    for (const file of sources(root)) {
      for (const match of readFileSync(file, 'utf8').matchAll(/aparte-alert--([a-z]+)/g)) {
        if (!kit.includes(`.aparte-alert--${match[1]}`)) unknown.push(`${relative(root, file)}: aparte-alert--${match[1]}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
