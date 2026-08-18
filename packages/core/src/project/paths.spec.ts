import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  displayPath,
  PathOutsideProjectError,
  resolveInProject,
} from './paths.js';

const ROOT = resolve('/projets/bonaparte');

describe('resolveInProject', () => {
  it('résout un chemin relatif simple', () => {
    expect(resolveInProject(ROOT, 'src/index.ts')).toBe(join(ROOT, 'src/index.ts'));
  });

  it('accepte les séparateurs POSIX comme Windows', () => {
    expect(resolveInProject(ROOT, 'src\\index.ts')).toBe(
      resolveInProject(ROOT, 'src/index.ts'),
    );
  });

  it('normalise les segments redondants', () => {
    expect(resolveInProject(ROOT, './src/../src/a.ts')).toBe(join(ROOT, 'src/a.ts'));
  });

  it('accepte la racine elle-même', () => {
    expect(resolveInProject(ROOT, '.')).toBe(ROOT);
  });

  it('accepte un chemin absolu situé dans le projet', () => {
    const inside = join(ROOT, 'src/a.ts');
    expect(resolveInProject(ROOT, inside)).toBe(inside);
  });

  it('refuse une remontée hors du projet', () => {
    expect(() => resolveInProject(ROOT, '../secrets.txt')).toThrow(
      PathOutsideProjectError,
    );
  });

  it('refuse une remontée déguisée au milieu du chemin', () => {
    expect(() => resolveInProject(ROOT, 'src/../../secrets.txt')).toThrow(
      PathOutsideProjectError,
    );
  });

  it('refuse un chemin absolu étranger', () => {
    expect(() => resolveInProject(ROOT, resolve('/etc/passwd'))).toThrow(
      PathOutsideProjectError,
    );
  });

  it('refuse un répertoire frère au préfixe commun', () => {
    // /projets/bonaparte-secret commence par la racine en tant que chaîne :
    // le test de préfixe naïf laisserait passer.
    expect(() => resolveInProject(ROOT, `${ROOT}-secret/a.ts`)).toThrow(
      PathOutsideProjectError,
    );
  });

  it('le message d’erreur nomme le chemin demandé', () => {
    expect(() => resolveInProject(ROOT, '../x')).toThrow(/\.\.\/x/);
  });
});

describe('displayPath', () => {
  it('rend un chemin relatif en séparateurs POSIX', () => {
    expect(displayPath(ROOT, join(ROOT, 'src', 'a.ts'))).toBe('src/a.ts');
  });

  it('rend « . » pour la racine', () => {
    expect(displayPath(ROOT, ROOT)).toBe('.');
  });

  it('laisse un chemin hors projet tel quel (diagnostic)', () => {
    const outside = resolve('/ailleurs/a.ts');
    expect(displayPath(ROOT, outside).split(sep).join('/')).toContain('ailleurs');
  });
});
