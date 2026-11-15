/**
 * What the « Fichiers » pane shows (task 6.3): a folder of the perimeter,
 * listed when it is opened, and a file read for its preview. Everything goes
 * through `resolveInPerimeter`, so a path outside — a link that leaves
 * included — is refused, never read (security rule 6).
 */

import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { displayInPerimeter, resolveInPerimeter } from '../project/paths.js';

export interface FileEntry {
  name: string;
  /** Where it is, as the core gives it back to read or list it. */
  path: string;
  /** How it is shown: from its folder (the folder's name first when there are several). */
  display: string;
  kind: 'dir' | 'file';
}

export type FileText = { kind: 'text'; text: string; truncated: boolean } | { kind: 'binary' };

/** The preview's cap: past it, the beginning, said cut. */
export const PREVIEW_BYTES = 256 * 1024;

/** Folders nobody browses: the repository's own. */
const HIDDEN = new Set(['.git']);

const effective = (roots: readonly string[], home: string): string[] => (roots.length > 0 ? [...roots] : [home]);

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** A folder's entries — the perimeter's top for null: its folder, or each of its folders. */
export async function listEntries(roots: readonly string[], dir: string | null, home: string = homedir()): Promise<FileEntry[]> {
  const inside = effective(roots, home);
  if (dir === null && inside.length > 1) {
    return inside.map((root) => ({ name: basename(resolve(root)), path: resolve(root), display: basename(resolve(root)), kind: 'dir' }));
  }
  const folder = resolveInPerimeter(inside, dir ?? inside[0]!, home);
  const found = await readdir(folder, { withFileTypes: true });
  const entries = await Promise.all(
    found
      .filter((entry) => !HIDDEN.has(entry.name))
      .map(async (entry): Promise<FileEntry> => {
        const path = join(folder, entry.name);
        const folderLike = entry.isDirectory() || (entry.isSymbolicLink() && (await isFolder(path)));
        return { name: entry.name, path, display: displayInPerimeter(inside, path), kind: folderLike ? 'dir' : 'file' };
      }),
  );
  return entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
}

/** A file's text for its preview, capped; a file that is not text says so. */
export async function readText(roots: readonly string[], path: string, cap = PREVIEW_BYTES, home: string = homedir()): Promise<FileText> {
  const file = resolveInPerimeter(effective(roots, home), path, home);
  const handle = await open(file, 'r');
  try {
    const size = (await handle.stat()).size;
    const length = Math.min(size, cap);
    const bytes = Buffer.alloc(length);
    await handle.read(bytes, 0, length, 0);
    // A NUL in the first bytes: not text.
    if (bytes.subarray(0, 8000).includes(0)) return { kind: 'binary' };
    return { kind: 'text', text: bytes.toString('utf8'), truncated: size > cap };
  } finally {
    await handle.close();
  }
}
