/**
 * A command as it can be launched without a shell — a stdio MCP server (task 10.5), what a project runs (task
 * 10.3), a plugin's `npm pack`, and run_command (audit 2026-11-21, D1). On Windows the usual commands are
 * wrappers: npm, npx, pnpm, yarn and every tool npm installs are `.cmd` shims, which only a shell runs — they run
 * instead as `node` and the script the shim names (npm's own script for npm and npx). A program found on the PATH
 * runs by its full path. Any other `.cmd` or `.bat` is refused: running it would hand its arguments to `cmd.exe`, a
 * command line. Elsewhere, nothing changes.
 */

import { readFileSync } from 'node:fs';
import { win32 } from 'node:path';
import { isProgramFile } from './spawn.js';

export interface ResolveOptions {
  env: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
  /** A file's text, or null: how a `.cmd` shim is read. */
  read?: (path: string) => string | null;
  /** The folder the command runs in: what a relative path to a program (`node_modules\.bin\tsc`) starts from. */
  cwd?: string;
  /**
   * A program the PATH does not hold: left as it is (its launch fails as a missing program does), or refused
   * with words a model can act on — run_command's choice, where the launch's own error read « spawn … ENOENT ».
   */
  notFound?: 'leave' | 'refuse';
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

const NPM_SCRIPTS: Record<string, string> = { npx: 'npx-cli.js', npm: 'npm-cli.js' };

/**
 * The script a shim of node runs, relative to the shim's folder: the quoted path given to node just before `%*`.
 * npm's cmd-shim writes `"%_prog%"  "%dp0%\…\pnpm.cjs" %*` (`_prog` being node), corepack's shims and pnpm's
 * `node_modules\.bin` write `node  "%~dp0\…" %*`, Yarn's installer `node "%~dp0\yarn.js" %*`.
 */
function shimTarget(text: string): string | null {
  const viaProg = /"%_prog%"\s+"%~?dp0%?\\([^"]+)"\s+%\*/i.exec(text);
  // `_prog` is node in a shim of a node script; cmd-shim sets it to sh or another interpreter otherwise.
  const progs = [...text.matchAll(/SET\s+"?_prog=([^"\r\n]*)/gi)].map((match) => match[1] ?? '');
  if (viaProg) return progs.every((prog) => /(?:^|\\)node(?:\.exe)?$/i.test(prog.trim())) ? (viaProg[1] ?? null) : null;
  return /\bnode(?:\.exe)?"?\s+"%~?dp0%?\\([^"]+)"\s+%\*/i.exec(text)?.[1] ?? null;
}

export function resolveCommand(command: string, args: readonly string[], options: ResolveOptions): { command: string; args: string[] } {
  if ((options.platform ?? process.platform) !== 'win32') return { command, args: [...args] };
  // An app execution alias is a link the file system cannot follow: still a program (review of phase 13).
  const exists = options.exists ?? isProgramFile;
  const path = Object.entries(options.env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
  const extensions = (Object.entries(options.env).find(([key]) => key.toUpperCase() === 'PATHEXT')?.[1] ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean);

  const found = find(command, path, extensions, exists, options.cwd) ?? (/\.(cmd|bat)$/i.test(command) ? command : null);
  if (!found) {
    if (options.notFound === 'refuse') {
      throw new Error(
        /[\\/]/.test(command)
          ? `${command} was not found: there is no such program.`
          : `${command} was not found on the PATH. On Windows a program runs without a shell: an .exe, or npm, npx, pnpm, yarn and the tools npm installs, which run through node. A tool of the project's node_modules runs through npx or pnpm exec.`,
      );
    }
    return { command, args: [...args] };
  }
  const extension = win32.extname(found).toLowerCase();
  if (extension !== '.cmd' && extension !== '.bat') return { command: found, args: [...args] };

  const dir = win32.dirname(found);
  const nodeOf = (): string | undefined =>
    [win32.join(dir, 'node.exe'), find('node', path, extensions, exists)].find((one): one is string => !!one && exists(one));
  const script = NPM_SCRIPTS[win32.basename(found, win32.extname(found)).toLowerCase()];
  if (script) {
    const cli = win32.join(dir, 'node_modules', 'npm', 'bin', script);
    const node = nodeOf();
    if (node && exists(cli)) return { command: node, args: [cli, ...args] };
  }
  // A shim of node (a global package npm installed, corepack's, node_modules\.bin's): the script it names, run by node.
  const named = shimTarget((options.read ?? readText)(found) ?? '');
  if (named) {
    const target = win32.join(dir, named);
    const node = nodeOf();
    if (node && exists(target)) return { command: node, args: [target, ...args] };
  }
  throw new Error(
    `${command} is a Windows batch file (${win32.basename(found)}) and no shim of node: it would run through a shell, which bonaparte never does. Run the program it calls instead (node and its script, python, an .exe).`,
  );
}

/**
 * The file a command names: itself when it has a path (a relative one from the folder it runs in), else the first
 * of the PATH, with each PATHEXT tried.
 */
function find(command: string, path: string, extensions: readonly string[], exists: (path: string) => boolean, cwd?: string): string | null {
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
    const base = dir ? win32.join(dir, command) : cwd && !win32.isAbsolute(command) ? win32.join(cwd, command) : command;
    if (own && exists(base)) return base;
    for (const extension of extensions) {
      const candidate = `${base}${extension.toLowerCase()}`;
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}
