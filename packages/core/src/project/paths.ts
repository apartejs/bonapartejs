/**
 * Tool path resolution, relative to the open project.
 *
 * Security boundary: an agent does not step outside the project. Every
 * path is resolved then verified to be a descendant of the root — a
 * well-placed `..` or a foreign absolute path is refused, not silently
 * corrected.
 */

import { homedir } from 'node:os';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

export class PathOutsideProjectError extends Error {
  constructor(
    readonly requested: string,
    readonly projectRoot: string,
  ) {
    // Message intended for the model: English, like everything that goes over the wire.
    super(
      `Path outside the project: ${requested} (root: ${projectRoot}). ` +
        'Tools cannot step outside the open project.',
    );
    this.name = 'PathOutsideProjectError';
  }
}

export function resolveInProject(projectRoot: string, requested: string): string {
  const root = resolve(projectRoot);
  // Models write POSIX or Windows separators interchangeably.
  const normalized = requested.replace(/\\/g, '/');
  const absolute = resolve(root, normalized);

  // `relative` answers the real question — being INSIDE the tree — where a
  // string-prefix test would confuse "/project" and "/project-secret".
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
    // The message NAMES the roots: that's what lets the model correct
    // itself on the next turn instead of retrying the same path.
    super(
      `Path outside the project perimeter: ${requested}. ` +
        `Allowed roots: ${roots.join(', ')}. ` +
        'Use an absolute path inside one of them.',
    );
    this.name = 'PathOutsidePerimeterError';
  }
}

/** Without a project, the perimeter is the home folder — and a path outside it is refused (Q-26). */
export class PathOutsideHomeError extends PathOutsidePerimeterError {
  constructor(requested: string, home: string) {
    super(requested, [home]);
    this.message =
      `Path outside the home folder: ${requested}. No project is open, so tools stay in ${home}. ` +
      'Ask the user to open a project that includes that folder.';
    this.name = 'PathOutsideHomeError';
  }
}

/** Does the path land inside this root (true descendance, not a prefix)? */
function contains(root: string, absolute: string): boolean {
  const rel = relative(resolve(root), absolute);
  if (rel === '') return true;
  return !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Resolves a path within the perimeter of an N-root project.
 *
 * One single, uniform rule: resolve — relatives against the FIRST root,
 * which is the default announced to the model — then verify the result
 * lands within the UNION of the roots. What matters is therefore where
 * the path ends up, not by which detour: a `..` that lands back in
 * another root of the same project is legitimate.
 *
 * With no root, the tools still work — the project is their PERIMETER,
 * not their condition of existence — confined to the home folder (Q-26):
 * "no project" is not the whole machine. A relative starts from home.
 */
export function resolveInPerimeter(roots: string[], requested: string): string {
  // Models write POSIX or Windows separators interchangeably.
  const normalized = requested.replace(/\\/g, '/');

  if (roots.length === 0) {
    // `resolve` ignores the base when the argument is already absolute:
    // both cases are handled at once.
    const home = homedir();
    const absolute = resolve(home, normalized);
    if (!contains(home, absolute)) throw new PathOutsideHomeError(requested, resolve(home));
    return absolute;
  }

  const absolute = resolve(resolve(roots[0] as string), normalized);
  if (!roots.some((root) => contains(root, absolute))) {
    throw new PathOutsidePerimeterError(requested, roots.map((r) => resolve(r)));
  }
  return absolute;
}

/**
 * Path displayable in a tool result.
 *
 * As soon as there is more than one root, the root's name prefixes the
 * path: without that, two `src/a.ts` coming from two repos would be
 * indistinguishable in grep output. Outside the perimeter, we return the
 * absolute path rather than fabricate a misleading relative one.
 */
export function displayInPerimeter(roots: string[], absolute: string): string {
  const target = resolve(absolute);
  const root = roots.find((candidate) => contains(candidate, target));
  if (!root) return target;

  const inner = displayPath(root, target);
  if (roots.length === 1) return inner;
  return `${basename(resolve(root))}/${inner}`;
}

/** Path displayable in tool results (relative, POSIX separators). */
export function displayPath(projectRoot: string, absolute: string): string {
  const rel = relative(resolve(projectRoot), resolve(absolute));
  if (rel === '') return '.';
  return rel.split(sep).join('/');
}
