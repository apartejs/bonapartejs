/**
 * The only place bonaparte launches a process. Everything else takes a
 * `SpawnFn`, or calls `spawnHidden`, and lint refuses `node:child_process`
 * anywhere but here.
 *
 * Two guarantees hold whatever the caller asks:
 *
 * - no shell: the program gets an argument array, so a file name, a branch
 *   name or the name of an npm script can never turn into a command;
 * - no visible console window: on Windows a new console takes the foreground
 *   and throws the person out of whatever they were doing.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { dirname, win32 } from 'node:path';

/** A launched process, as Node gives it. Other modules take the type from here. */
export type SpawnedProcess = ChildProcess;

/** The shape of Node's `spawn`: what a test replaces to watch a launch without doing it. */
export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => SpawnedProcess;

/** Node's spawn options, minus the two this module decides, plus the seams for tests. */
export type SpawnHiddenOptions = Omit<SpawnOptions, 'shell' | 'windowsHide'> & {
  spawn?: SpawnFn;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
};

/**
 * A program on the PATH: a file, or a link Windows opens itself — an app execution alias (python, winget) is a link
 * the file system cannot follow, yet Windows runs it (review of phase 13). Never a folder.
 */
export function isProgramFile(path: string): boolean {
  try {
    return !lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * On Windows a bare program name is looked for in the folder it runs in before the PATH: a `git.exe` a
 * repository carries would run in place of git (audit 13.4). A bare name is therefore resolved on the PATH
 * alone — its absolute entries, quotes taken off as Windows writes them, the name as it is then with `.com` and
 * `.exe` as Windows completes it. One the PATH does not hold is not launched at all: it fails as a missing
 * program fails, from a folder that does not exist.
 */
function onPathOnly(
  command: string,
  options: { cwd?: string | URL | undefined; env?: NodeJS.ProcessEnv | undefined },
  platform: NodeJS.Platform,
  exists: (path: string) => boolean,
): { command: string; cwd?: string | URL } {
  const asked = options.cwd !== undefined ? { cwd: options.cwd } : {};
  if (platform !== 'win32' || /[\\/]/.test(command)) return { command, ...asked };
  const env = options.env ?? process.env;
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH');
  const dirs = (pathKey ? (env[pathKey] ?? '') : '')
    .split(';')
    .map((dir) => dir.trim().replace(/^"(.*)"$/, '$1'))
    // Only a full path: `.`, `bin` or `C:foo` would be the folder the program runs in again.
    .filter((dir) => /^[a-z]:[\\/]/i.test(dir) || /^\\\\[^\\]/.test(dir));
  const own = win32.extname(command) !== '';
  for (const dir of dirs) {
    const base = win32.join(dir, command);
    for (const candidate of own ? [base, `${base}.com`, `${base}.exe`] : [`${base}.com`, `${base}.exe`]) {
      if (exists(candidate)) return { command: candidate, ...asked };
    }
  }
  return { command: win32.join(dirname(process.execPath), 'bonaparte-not-on-path', own ? command : `${command}.exe`), ...asked };
}

export function spawnHidden(
  command: string,
  args: readonly string[],
  options: SpawnHiddenOptions = {},
): SpawnedProcess {
  const { spawn = nodeSpawn, platform = process.platform, exists, ...rest } = options;
  // A test that replaces spawn describes its own machine: nothing of this one's PATH is looked up, unless it says how.
  const found =
    options.spawn && !exists
      ? { command, ...(rest.cwd !== undefined ? { cwd: rest.cwd } : {}) }
      : onPathOnly(command, rest, platform, exists ?? isProgramFile);
  // Written last, so that a caller who slipped them in (JavaScript, a cast) loses.
  return spawn(found.command, [...args], { ...rest, ...(found.cwd !== undefined ? { cwd: found.cwd } : {}), shell: false, windowsHide: true });
}

/** Options of a program launched with a window of its own: what it is given, and the seam for tests. */
export interface SpawnWindowedOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  spawn?: SpawnFn;
}

/**
 * The one exception (task 13.3): a program that shows a window of its own —
 * bonaparte itself, launched by `npx @aparte/bonaparte`. Windows applies a
 * hidden launch to the first window such a program shows, so it is not
 * hidden; it opens no console either, being a windowed program, and it is
 * detached from the command that launched it. Never a shell, never a batch
 * file or a script: those run in a console.
 */
export function spawnWindowed(command: string, args: readonly string[], options: SpawnWindowedOptions = {}): SpawnedProcess {
  if (/\.(cmd|bat|ps1|com|vbs|js|mjs|cjs|sh)$/i.test(command)) {
    throw new Error(`${command} is a script: only a program with a window of its own is launched this way.`);
  }
  const { spawn = nodeSpawn, ...rest } = options;
  return spawn(command, [...args], { ...rest, shell: false, windowsHide: false, detached: true, stdio: 'ignore' });
}
