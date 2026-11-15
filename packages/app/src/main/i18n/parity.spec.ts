/**
 * The few words the main process shows — the notification area's menu —
 * in French and in English, with the same keys.
 */

import { describe, expect, it } from 'vitest';
import { en } from './en.js';
import { fr } from './fr.js';
import { mainWords } from './index.js';

function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value)
    .flatMap(([key, child]) => keysOf(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

describe('the words of the main process', () => {
  it('have the same keys in both languages, none empty', () => {
    expect(keysOf(fr)).toEqual(keysOf(en));
    for (const words of [fr, en]) for (const text of Object.values(words.tray)) expect(text.trim()).not.toBe('');
  });

  it('follow the language of the interface', () => {
    expect(mainWords('fr').tray.open).toBe('Ouvrir bonaparte');
    expect(mainWords('en').tray.open).toBe('Open bonaparte');
  });
});
