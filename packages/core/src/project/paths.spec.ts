import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  displayInPerimeter,
  displayPath,
  PathOutsidePerimeterError,
  PathOutsideProjectError,
  resolveInPerimeter,
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

// ─── Périmètre à N racines ────────────────────────────────────────────────

const A = resolve('/projets/alpha');
const B = resolve('/projets/beta');

describe('resolveInPerimeter', () => {
  describe('sans racine — le projet est le périmètre, pas la condition', () => {
    it('résout un relatif depuis le dossier personnel', () => {
      const got = resolveInPerimeter([], 'notes.txt');
      expect(got).toBe(resolve(homedir(), 'notes.txt'));
    });

    it('laisse passer un absolu quelconque : rien n’est confiné', () => {
      const ailleurs = resolve('/tmp/ailleurs/x.txt');
      expect(resolveInPerimeter([], ailleurs)).toBe(ailleurs);
    });
  });

  describe('une seule racine — comportement identique à avant', () => {
    it('résout un relatif dans la racine', () => {
      expect(resolveInPerimeter([A], 'src/a.ts')).toBe(join(A, 'src/a.ts'));
    });

    it('refuse une évasion par ..', () => {
      expect(() => resolveInPerimeter([A], '../secrets.txt')).toThrow(
        PathOutsidePerimeterError,
      );
    });

    it('refuse un absolu étranger', () => {
      expect(() => resolveInPerimeter([A], B)).toThrow(PathOutsidePerimeterError);
    });
  });

  describe('plusieurs racines', () => {
    it('résout un relatif contre la PREMIÈRE racine', () => {
      expect(resolveInPerimeter([A, B], 'src/a.ts')).toBe(join(A, 'src/a.ts'));
      // L'ordre est sémantique : inverser change la racine par défaut.
      expect(resolveInPerimeter([B, A], 'src/a.ts')).toBe(join(B, 'src/a.ts'));
    });

    it('accepte un absolu situé dans n’importe quelle racine', () => {
      expect(resolveInPerimeter([A, B], join(B, 'lib/b.ts'))).toBe(join(B, 'lib/b.ts'));
    });

    it('accepte un relatif qui sort de la première mais retombe dans une autre', () => {
      // Le périmètre est l'UNION des racines : ce qui compte est où le chemin
      // atterrit, pas par quel détour il y arrive.
      const got = resolveInPerimeter([A, B], '../beta/lib/b.ts');
      expect(got).toBe(join(B, 'lib/b.ts'));
    });

    it('refuse ce qui n’atterrit dans aucune racine', () => {
      expect(() => resolveInPerimeter([A, B], resolve('/projets/gamma/x'))).toThrow(
        PathOutsidePerimeterError,
      );
    });

    it('le refus NOMME les racines, pour que le modèle se corrige seul', () => {
      let message = '';
      try {
        resolveInPerimeter([A, B], resolve('/projets/gamma/x'));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(A);
      expect(message).toContain(B);
    });
  });

  it('accepte les séparateurs Windows comme POSIX', () => {
    expect(resolveInPerimeter([A], 'src\\a.ts')).toBe(
      resolveInPerimeter([A], 'src/a.ts'),
    );
  });
});

describe('displayInPerimeter', () => {
  it('avec une seule racine, reste relatif et sobre', () => {
    expect(displayInPerimeter([A], join(A, 'src/a.ts'))).toBe('src/a.ts');
  });

  it('avec plusieurs racines, préfixe du nom de la racine qui contient', () => {
    // Sans ce préfixe, deux fichiers « src/a.ts » de deux dépôts seraient
    // indistinguables dans une sortie de grep.
    expect(displayInPerimeter([A, B], join(B, 'src/a.ts'))).toBe('beta/src/a.ts');
  });

  it('hors périmètre, rend le chemin absolu plutôt que de mentir', () => {
    const ailleurs = resolve('/tmp/x.txt');
    expect(displayInPerimeter([A], ailleurs)).toBe(ailleurs);
  });

  it('sans racine, rend l’absolu', () => {
    const p = resolve('/tmp/x.txt');
    expect(displayInPerimeter([], p)).toBe(p);
  });
});
