/**
 * Résolution des chemins d'outils, relative au projet ouvert.
 *
 * Frontière de sécurité : un agent ne sort pas du projet. Tout chemin est
 * résolu puis vérifié comme descendant de la racine — un `..` bien placé ou
 * un chemin absolu étranger est refusé, pas silencieusement corrigé.
 */

import { homedir } from 'node:os';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

export class PathOutsideProjectError extends Error {
  constructor(
    readonly requested: string,
    readonly projectRoot: string,
  ) {
    // Message destiné au modèle : anglais, comme tout ce qui part sur le fil.
    super(
      `Path outside the project: ${requested} (root: ${projectRoot}). ` +
        'Tools cannot step outside the open project.',
    );
    this.name = 'PathOutsideProjectError';
  }
}

export function resolveInProject(projectRoot: string, requested: string): string {
  const root = resolve(projectRoot);
  // Les modèles écrivent indifféremment des séparateurs POSIX ou Windows.
  const normalized = requested.replace(/\\/g, '/');
  const absolute = resolve(root, normalized);

  // `relative` répond à la vraie question — être DANS l'arbre — là où un test
  // de préfixe de chaîne confondrait « /projet » et « /projet-secret ».
  const rel = relative(root, absolute);
  const escapes = rel.startsWith('..') || (rel !== '' && isAbsolute(rel));
  if (escapes) throw new PathOutsideProjectError(requested, root);

  return absolute;
}

export class PathOutsidePerimeterError extends Error {
  constructor(
    readonly requested: string,
    readonly roots: string[],
  ) {
    // Le message NOMME les racines : c'est ce qui permet au modèle de se
    // corriger au tour suivant au lieu de retenter le même chemin.
    super(
      `Path outside the project perimeter: ${requested}. ` +
        `Allowed roots: ${roots.join(', ')}. ` +
        'Use an absolute path inside one of them.',
    );
    this.name = 'PathOutsidePerimeterError';
  }
}

/** Le chemin atterrit-il dans cette racine (vraie descendance, pas préfixe) ? */
function contains(root: string, absolute: string): boolean {
  const rel = relative(resolve(root), absolute);
  if (rel === '') return true;
  return !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Résout un chemin dans le périmètre d'un projet à N racines.
 *
 * Une seule règle, uniforme : on résout — les relatifs contre la PREMIÈRE
 * racine, qui est le défaut annoncé au modèle — puis on vérifie que le résultat
 * atterrit dans l'UNION des racines. Ce qui compte est donc où le chemin
 * arrive, pas par quel détour : un `..` qui retombe dans une autre racine du
 * même projet est légitime.
 *
 * Sans racine, rien n'est confiné : le projet est le PÉRIMÈTRE des outils, pas
 * leur condition d'existence. Un relatif part alors du dossier personnel.
 */
export function resolveInPerimeter(roots: string[], requested: string): string {
  // Les modèles écrivent indifféremment des séparateurs POSIX ou Windows.
  const normalized = requested.replace(/\\/g, '/');

  if (roots.length === 0) {
    // `resolve` ignore la base quand l'argument est déjà absolu : les deux cas
    // se traitent d'un coup.
    return resolve(homedir(), normalized);
  }

  const absolute = resolve(resolve(roots[0] as string), normalized);
  if (!roots.some((root) => contains(root, absolute))) {
    throw new PathOutsidePerimeterError(requested, roots.map((r) => resolve(r)));
  }
  return absolute;
}

/**
 * Chemin affichable dans un résultat d'outil.
 *
 * Dès qu'il y a plusieurs racines, le nom de la racine préfixe le chemin :
 * sans ça, deux `src/a.ts` venant de deux dépôts seraient indistinguables dans
 * une sortie de grep. Hors périmètre, on rend l'absolu plutôt que de fabriquer
 * un relatif trompeur.
 */
export function displayInPerimeter(roots: string[], absolute: string): string {
  const target = resolve(absolute);
  const root = roots.find((candidate) => contains(candidate, target));
  if (!root) return target;

  const inner = displayPath(root, target);
  if (roots.length === 1) return inner;
  return `${basename(resolve(root))}/${inner}`;
}

/** Chemin affichable dans les résultats d'outils (relatif, séparateurs POSIX). */
export function displayPath(projectRoot: string, absolute: string): string {
  const rel = relative(resolve(projectRoot), resolve(absolute));
  if (rel === '') return '.';
  return rel.split(sep).join('/');
}
