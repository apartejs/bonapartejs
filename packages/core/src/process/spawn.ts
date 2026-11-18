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

/** A launched process, as Node gives it. Other modules take the type from here. */
export type SpawnedProcess = ChildProcess;

/** The shape of Node's `spawn`: what a test replaces to watch a launch without doing it. */
export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => SpawnedProcess;

/** Node's spawn options, minus the two this module decides, plus the seam for tests. */
export type SpawnHiddenOptions = Omit<SpawnOptions, 'shell' | 'windowsHide'> & { spawn?: SpawnFn };

export function spawnHidden(
  command: string,
  args: readonly string[],
  options: SpawnHiddenOptions = {},
): SpawnedProcess {
  const { spawn = nodeSpawn, ...rest } = options;
  // Written last, so that a caller who slipped them in (JavaScript, a cast) loses.
  return spawn(command, [...args], { ...rest, shell: false, windowsHide: true });
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
