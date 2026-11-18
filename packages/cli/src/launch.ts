/**
 * `npx @aparte/bonaparte` with no argument (task 13.3): the app the package
 * ships, under the Electron it depends on. What it costs is said before it is
 * paid — Electron's download, the first time. The app is launched with a
 * window of its own, detached: the terminal is given back at once.
 */

import { join } from 'node:path';
import type { SpawnedProcess } from '@aparte/bonaparte-core';

export interface LaunchWords {
  appNotBuilt: string;
  electronMissing: string;
  downloadingElectron: string;
  launched: string;
}

export interface LaunchDeps {
  /** The folder of the command's package (its package.json). */
  packageRoot: string;
  exists(path: string): boolean;
  /** Electron's `path.txt`: the name of its binary under `dist/`, or null when it is missing. */
  readPathTxt(path: string): string | null;
  /** The folder of the `electron` package, or null when it is not installed. */
  electronDir(): string | null;
  /** Downloads Electron's binary (its own install script, without a shell). */
  installElectron(electronDir: string): Promise<void>;
  /** The path of Electron's binary. */
  electronBinary(electronDir: string): string;
  env: NodeJS.ProcessEnv;
  spawn(command: string, args: readonly string[], options: { env: NodeJS.ProcessEnv }): SpawnedProcess;
  say(line: string): void;
  words: LaunchWords;
}

/** A built app: its package.json and its main. */
function isBuiltApp(dir: string, exists: (path: string) => boolean): boolean {
  return exists(join(dir, 'package.json')) && exists(join(dir, 'out', 'main', 'index.js'));
}

/**
 * The app the package ships (`app/`, assembled before it is packed), else the
 * one beside it in the repository (`packages/app`, built). A source tree is
 * not a launchable app: saying so beats letting Electron fail on a missing main.
 */
export function resolveAppDir(packageRoot: string, exists: (path: string) => boolean): string | null {
  for (const dir of [join(packageRoot, 'app'), join(packageRoot, '..', 'app')]) {
    if (isBuiltApp(dir, exists)) return dir;
  }
  return null;
}

/** Electron's binary is fetched by its install script, which a package manager may have skipped. */
export function electronNeedsDownload(electronDir: string, readPathTxt: (path: string) => string | null, exists: (path: string) => boolean): boolean {
  const name = readPathTxt(join(electronDir, 'path.txt'))?.trim();
  if (!name) return true;
  return !exists(join(electronDir, 'dist', name));
}

export async function launchFromCli(deps: LaunchDeps): Promise<number> {
  const appDir = resolveAppDir(deps.packageRoot, deps.exists);
  if (!appDir) {
    deps.say(deps.words.appNotBuilt);
    return 1;
  }
  const electronDir = deps.electronDir();
  if (!electronDir) {
    deps.say(deps.words.electronMissing);
    return 1;
  }
  if (electronNeedsDownload(electronDir, deps.readPathTxt, deps.exists)) {
    deps.say(deps.words.downloadingElectron);
    await deps.installElectron(electronDir);
  }
  // Inherited from an Electron that launched this command, it would make the app a plain Node with no window.
  const env = { ...deps.env };
  delete env['ELECTRON_RUN_AS_NODE'];
  const child = deps.spawn(deps.electronBinary(electronDir), [appDir], { env });
  child.unref();
  deps.say(deps.words.launched);
  return 0;
}
