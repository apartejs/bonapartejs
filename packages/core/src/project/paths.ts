/**
 * Résolution des chemins d'outils, relative au projet ouvert.
 *
 * Frontière de sécurité : un agent ne sort pas du projet. Tout chemin est
 * résolu puis vérifié comme descendant de la racine — un `..` bien placé ou
 * un chemin absolu étranger est refusé, pas silencieusement corrigé.
 */

import { isAbsolute, relative, resolve, sep } from 'node:path';

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

/** Chemin affichable dans les résultats d'outils (relatif, séparateurs POSIX). */
export function displayPath(projectRoot: string, absolute: string): string {
  const rel = relative(resolve(projectRoot), resolve(absolute));
  if (rel === '') return '.';
  return rel.split(sep).join('/');
}
