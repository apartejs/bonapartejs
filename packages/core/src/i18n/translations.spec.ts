import { describe, expect, it } from 'vitest';
import { EN, FR, harnessT } from './translations.js';

/** Arbre des clés d'un objet de traductions, feuilles = chemins complets. */
function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      return keyPaths(value as Record<string, unknown>, path);
    }
    return [path];
  });
}

describe('harness i18n', () => {
  it('FR et EN exposent exactement les mêmes clés', () => {
    expect(keyPaths(FR as unknown as Record<string, unknown>).sort()).toEqual(
      keyPaths(EN as unknown as Record<string, unknown>).sort(),
    );
  });

  it('aucune chaîne vide dans aucune locale', () => {
    for (const locale of [FR, EN]) {
      const walk = (obj: Record<string, unknown>): void => {
        for (const value of Object.values(obj)) {
          if (typeof value === 'string') expect(value.trim()).not.toBe('');
          else if (value !== null && typeof value === 'object')
            walk(value as Record<string, unknown>);
        }
      };
      walk(locale as unknown as Record<string, unknown>);
    }
  });

  it('harnessT résout chaque locale supportée', () => {
    expect(harnessT('fr')).toBe(FR);
    expect(harnessT('en')).toBe(EN);
  });
});
