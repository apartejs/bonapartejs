/**
 * aparté's `<aparte-icon>` draws nothing, and says nothing, for a name it does not know: « plus » and « panel »
 * left empty squares on the Plugins page and an empty « Créer avec l’agent ». Every one goes through `Glyph`, whose
 * name is aparté's own type — so a name aparté does not have is a type error, never an empty square.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('aparté’s icons', () => {
  it('are drawn through Glyph alone, whose name aparté knows', () => {
    const raw = sources(root)
      .filter((file) => !file.endsWith(join('shell', 'icons.tsx')))
      .filter((file) => /createElement\(\s*['"`]aparte-icon['"`]|<aparte-icon[\s>]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file));
    expect(raw).toEqual([]);
  });
});
