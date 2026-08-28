/**
 * `bonaparte` with no argument launches the Electron app.
 *
 * Two layouts are supported. Published, the CLI package ships an assembled
 * `app/` directory (the built main, preload and renderer, plus the built-in
 * plugins) and depends on `electron`, so `npx @aparte/bonaparte` has both the
 * runtime and the app. In the monorepo, the sibling `packages/app` is used
 * as is once built.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * The app directory to hand to Electron, or null when none is built. A
 * directory counts only when it carries both a manifest and a built main:
 * a source tree is not a launchable app, and saying so beats letting
 * Electron fail on a missing entry point.
 */
export function resolveAppDir(
  packageRoot: string,
  exists: (path: string) => boolean,
): string | null {
  for (const dir of [join(packageRoot, 'app'), join(packageRoot, '..', 'app')]) {
    if (exists(join(dir, 'package.json')) && exists(join(dir, 'out', 'main', 'index.js'))) {
      return dir;
    }
  }
  return null;
}

/** Directory of the installed `electron` package, or null when it is missing. */
export function electronPackageDir(): string | null {
  try {
    return dirname(createRequire(import.meta.url).resolve('electron/package.json'));
  } catch {
    return null;
  }
}

/**
 * Whether requiring `electron` is about to download its binary.
 *
 * The package no longer fetches the binary at install time: the first
 * `require('electron')` runs its `install.js` (about 110 MB, once, cached by
 * `@electron/get`). The product rule is that a cost is announced before it
 * is paid, so the CLI checks first and says so — the package's own message
 * is English-only and arrives once the download has started.
 */
export function electronNeedsDownload(
  electronDir: string,
  readPathTxt: (path: string) => string | null,
  exists: (path: string) => boolean,
): boolean {
  const named = readPathTxt(join(electronDir, 'path.txt'))?.trim();
  if (!named) return true;
  return !exists(join(electronDir, 'dist', named));
}

/** Path of the Electron executable (downloading it if needed), or null when the package is missing. */
export function electronBinary(): string | null {
  try {
    // In Node, requiring `electron` yields the path of the executable.
    return createRequire(import.meta.url)('electron') as string;
  } catch {
    return null;
  }
}

export interface LaunchOptions {
  appDir: string;
  electron: string;
  env?: Record<string, string | undefined>;
}

/** Runs the app and resolves with its exit code once the window is closed. */
export function launchApp(options: LaunchOptions): Promise<number> {
  // Inherited from a parent Electron process, this variable would turn the
  // child into a plain Node process: no window at all.
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = { ...process.env, ...options.env };
  return new Promise((resolve, reject) => {
    const child = spawn(options.electron, [options.appDir], {
      stdio: 'inherit',
      env,
      windowsHide: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 0));
  });
}
