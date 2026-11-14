/**
 * The interface is French and English from the first string: one file per
 * language, with the same keys. A key missing on one side would show as a
 * blank, or as English in the middle of a French screen.
 */

import { describe, expect, it } from 'vitest';
import { en } from './en.js';
import { fr } from './fr.js';

function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value)
    .flatMap(([key, child]) => keysOf(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(stringsOf);
}

describe('the two languages of the interface', () => {
  it('have exactly the same keys', () => {
    expect(keysOf(fr)).toEqual(keysOf(en));
  });

  it('leave no string empty', () => {
    for (const text of [...stringsOf(fr), ...stringsOf(en)]) expect(text.trim()).not.toBe('');
  });

  it('are two translations, not one text twice', () => {
    expect(fr.composer.placeholder).not.toBe(en.composer.placeholder);
  });
});
