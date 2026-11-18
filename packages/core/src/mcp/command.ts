/**
 * The command of a stdio MCP server, as it can be launched without a shell (task 10.5). On Windows the usual
 * commands are wrappers: `npx` and `npm` are `.cmd` files, which only a shell runs — they run instead as `node`
 * and npm's own script beside it. A program found on the PATH runs by its full path. Any other `.cmd` or `.bat`
 * is refused: running it would hand its arguments to `cmd.exe`, a command line. Elsewhere, nothing changes.
 */

import { readFileSync } from 'node:fs';
import { isProgramFile } from '../process/spawn.js';
import { win32 } from 'node:path';

export interface ResolveOptions {
  env: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
  /** A file's text, or null: how a `.cmd` shim is read. */
  read?: (path: string) => string | null;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

const NPM_SCRIPTS: Record<string, string> = { npx: 'npx-cli.js', npm: 'npm-cli.js' };

export function resolveCommand(command: string, args: readonly string[], options: ResolveOptions): { command: string; args: string[] } {
  if ((options.platform ?? process.platform) !== 'win32') return { command, args: [...args] };
  // An app execution alias is a link the file system cannot follow: still a program (review of phase 13).
  const exists = options.exists ?? isProgramFile;
  const path = Object.entries(options.env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
  const extensions = (Object.entries(options.env).find(([key]) => key.toUpperCase() === 'PATHEXT')?.[1] ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean);

  const found = find(command, path, extensions, exists) ?? (/\.(cmd|bat)$/i.test(command) ? command : null);
  if (!found) return { command, args: [...args] };
  const extension = win32.extname(found).toLowerCase();
  if (extension !== '.cmd' && extension !== '.bat') return { command: found, args: [...args] };

  const script = NPM_SCRIPTS[win32.basename(found, win32.extname(found)).toLowerCase()];
  const dir = win32.dirname(found);
  if (script) {
    const node = win32.join(dir, 'node.exe');
    const cli = win32.join(dir, 'node_modules', 'npm', 'bin', script);
    if (exists(node) && exists(cli)) return { command: node, args: [cli, ...args] };
  }
  // A shim npm wrote for a global package (pnpm, yarn…): the script it names, run by node.
  const named = /"%dp0%\\([^"]+\.(?:c|m)?js)"/i.exec((options.read ?? readText)(found) ?? '')?.[1];
  if (named) {
    const target = win32.join(dir, named);
    const node = [win32.join(dir, 'node.exe'), find('node', path, extensions, exists)].find((one): one is string => !!one && exists(one));
    if (node && exists(target)) return { command: node, args: [target, ...args] };
  }
  throw new Error(
    `${command} is a Windows batch file (${win32.basename(found)}): it would run through a shell, which bonaparte never does. Give the program itself (node, python, an .exe).`,
  );
}

/** The file a command names: itself when it has a path, else the first of the PATH, with each PATHEXT tried. */
function find(command: string, path: string, extensions: readonly string[], exists: (path: string) => boolean): string | null {
  const named = /[\\/]/.test(command);
  // Only the PATH's full entries, quotes taken off: a relative one is the folder it runs in again (audit 13.4).
  const dirs = named
    ? ['']
    : path
        .split(';')
        .map((dir) => dir.trim().replace(/^"(.*)"$/, '$1'))
        .filter((dir) => /^[a-z]:[\\/]/i.test(dir) || /^\\\\[^\\]/.test(dir));
  const own = win32.extname(command) !== '';
  for (const dir of dirs) {
    const base = dir ? win32.join(dir, command) : command;
    if (own && exists(base)) return base;
    for (const extension of extensions) {
      const candidate = `${base}${extension.toLowerCase()}`;
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}
