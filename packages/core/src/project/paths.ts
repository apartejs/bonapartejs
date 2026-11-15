/**
 * The perimeter of a conversation: the folders of its project, or — without
 * a project — the home folder, never the whole machine, never a network
 * path. Where a path really lands decides, not how it is spelled: a link or
 * a junction inside the project can lead anywhere, so the real location is
 * checked as well as the written one; an 8.3 short name reaches the
 * permission check as the long name it is; a stream name (`a.txt:hidden`)
 * is not a file. The refusals are written for the model (English), and name
 * the folders allowed, so that it corrects itself instead of retrying.
 */

import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export class PathOutsidePerimeterError extends Error {
  constructor(
    readonly requested: string,
    readonly roots: readonly string[],
  ) {
    super(`Path outside the project perimeter: ${requested}. Allowed roots: ${roots.join(', ')}. Use a path inside one of them.`);
    this.name = 'PathOutsidePerimeterError';
  }
}

export class PathOutsideHomeError extends PathOutsidePerimeterError {
  constructor(requested: string, home: string) {
    super(requested, [home]);
    this.message =
      `Path outside the home folder: ${requested}. No project is open, so tools stay in ${home}. ` +
      'Ask the user to open a project that includes that folder.';
    this.name = 'PathOutsideHomeError';
  }
}

export class InvalidPathError extends Error {
  constructor(requested: string) {
    super(`Invalid path: ${requested} (a stream or device name, not a file). Use a plain file path.`);
    this.name = 'InvalidPathError';
  }
}

export class NetworkPathError extends Error {
  constructor(requested: string) {
    super(`Network path refused: ${requested}. Tools work on the folders of this machine only.`);
    this.name = 'NetworkPathError';
  }
}

/** `\\server\share`, `//server/share`, and the `\\?\` and `\\.\` prefixes: never a perimeter, never a target. */
function isNetwork(path: string): boolean {
  return /^[\\/]{2}/.test(path);
}

function contains(root: string, absolute: string): boolean {
  const rel = relative(resolve(root), absolute);
  if (rel === '') return true;
  return !rel.startsWith('..') && !isAbsolute(rel);
}

function refuseStreams(requested: string, absolute: string): void {
  // After the drive's colon, a colon names a stream (or a device): not a file.
  if (process.platform === 'win32' && absolute.slice(2).includes(':')) throw new InvalidPathError(requested);
}

/** Past this many links followed, a path is a loop, never a location. */
const MAX_LINKS = 40;

/**
 * The real location of a path: links, junctions and 8.3 names resolved. A
 * path that does not exist yet is the real location of its nearest existing
 * ancestor, with the rest appended — and a link whose target does not exist
 * yet is where it points, never where it stands: a write through it lands
 * at its target.
 */
export function realLocation(absolute: string, links = 0): string {
  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      return join(realpathSync.native(current), ...missing.reverse());
    } catch {
      const stat = lstatSync(current, { throwIfNoEntry: false });
      if (stat?.isSymbolicLink()) {
        if (links >= MAX_LINKS) throw new Error(`Too many links to follow: ${absolute}`);
        // A relative target is read from where the link really stands, never from how it was reached.
        const target = resolve(realLocation(dirname(current), links + 1), readlinkSync(current));
        return join(realLocation(target, links + 1), ...missing.reverse());
      }
      const parent = dirname(current);
      if (parent === current) return absolute;
      missing.push(basename(current));
      current = parent;
    }
  }
}

/** The absolute path a requested path lands on inside the perimeter; throws, for the model to read, outside it. */
export function resolveInPerimeter(roots: readonly string[], requested: string, home: string = homedir()): string {
  if (isNetwork(requested)) throw new NetworkPathError(requested);
  for (const root of roots) if (isNetwork(root)) throw new NetworkPathError(root);
  // Models write POSIX or Windows separators interchangeably.
  const normalized = requested.replace(/\\/g, '/');

  if (roots.length === 0) {
    const absolute = resolve(home, normalized);
    if (isNetwork(absolute)) throw new NetworkPathError(requested);
    refuseStreams(requested, absolute);
    const real = realLocation(absolute);
    if (isNetwork(real)) throw new NetworkPathError(requested);
    if (!contains(home, absolute) || !contains(realLocation(resolve(home)), real)) {
      throw new PathOutsideHomeError(requested, resolve(home));
    }
    return absolute;
  }

  const absolute = resolve(resolve(roots[0]!), normalized);
  if (isNetwork(absolute)) throw new NetworkPathError(requested);
  refuseStreams(requested, absolute);
  // Where the path lands as written, AND where it really lands.
  const real = realLocation(absolute);
  if (isNetwork(real)) throw new NetworkPathError(requested);
  if (!roots.some((root) => contains(root, absolute) && contains(realLocation(resolve(root)), real))) {
    throw new PathOutsidePerimeterError(requested, roots.map((root) => resolve(root)));
  }
  return absolute;
}

/** Is it inside — without throwing: a write outside the perimeter asks, it is not refused. */
export function isInPerimeter(roots: readonly string[], requested: string, home: string = homedir()): boolean {
  try {
    resolveInPerimeter(roots, requested, home);
    return true;
  } catch {
    return false;
  }
}

/** The path the permission check reads: the real one (an 8.3 name, a link, resolved); the request as given when it lands nowhere. */
export function permissionPath(roots: readonly string[], requested: string, home: string = homedir()): string {
  try {
    return realLocation(resolveInPerimeter(roots, requested, home));
  } catch {
    return requested;
  }
}

/** How a path is shown: from its folder (the folder's name first when there are several); whole outside them. */
export function displayInPerimeter(roots: readonly string[], absolute: string): string {
  const target = resolve(absolute);
  const root = roots.find((candidate) => contains(candidate, target));
  if (!root) return target;
  const rel = relative(resolve(root), target);
  const inner = rel === '' ? '.' : rel.split(sep).join('/');
  return roots.length === 1 ? inner : `${basename(resolve(root))}/${inner}`;
}
