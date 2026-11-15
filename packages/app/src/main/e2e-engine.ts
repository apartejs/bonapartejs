/**
 * What an end-to-end test may change in the engine, read from the
 * environment in a test run (`BONAPARTE_E2E=1`) and only then: what to
 * launch instead of llama.cpp (the fake binary), the video memory the card
 * is said to have, the port of the managed server, and where llama.cpp's
 * releases are read — a local server of the test, never GitHub.
 */

import { posix, win32 } from 'node:path';
import type { CoreDeps } from '@aparte/bonaparte-core';

export function e2eEngineDeps(
  env: Record<string, string | undefined>,
  e2e: boolean,
): Pick<CoreDeps, 'llamaCommand' | 'gpuMemory' | 'port' | 'llamaReleases' | 'home' | 'diskRoots'> {
  if (!e2e) return {};
  const deps: Pick<CoreDeps, 'llamaCommand' | 'gpuMemory' | 'port' | 'llamaReleases' | 'home' | 'diskRoots'> = {};
  // The tools' home folder: the test's, never the person's.
  const home = env['BONAPARTE_E2E_HOME'];
  if (home && (win32.isAbsolute(home) || posix.isAbsolute(home))) deps.home = home;
  try {
    const command = JSON.parse(env['BONAPARTE_E2E_LLAMA_COMMAND'] ?? 'null') as unknown;
    if (Array.isArray(command) && command.length > 0 && command.every((part) => typeof part === 'string')) {
      deps.llamaCommand = command as string[];
    }
  } catch {
    /* not a command: ignored */
  }
  const gpu = Number(env['BONAPARTE_E2E_GPU_BYTES']);
  if (Number.isFinite(gpu) && gpu > 0) deps.gpuMemory = async () => gpu;
  const port = Number(env['BONAPARTE_E2E_ENGINE_PORT']);
  if (Number.isInteger(port) && port > 0 && port < 65536) deps.port = port;
  // « Chercher sur tout le disque »: the test's folder, never the person's drives.
  const disk = env['BONAPARTE_E2E_DISK_ROOT'];
  if (disk && (win32.isAbsolute(disk) || posix.isAbsolute(disk))) deps.diskRoots = async () => [disk];
  const releases = env['BONAPARTE_E2E_LLAMA_RELEASES'];
  deps.llamaReleases = releases && /^http:\/\/127\.0\.0\.1:\d+\//.test(releases) ? releases : null;
  return deps;
}

/**
 * The folder « Choisir un dossier… » gives in a test run: the test's own
 * (`BONAPARTE_E2E_PICK_FOLDER`), or none — never the system's dialog, a
 * window on the screen. `undefined` outside a test run: the system asks.
 */
export function e2ePickedFolder(env: Record<string, string | undefined>, e2e: boolean): string | null | undefined {
  if (!e2e) return undefined;
  const folder = env['BONAPARTE_E2E_PICK_FOLDER'];
  return folder && (win32.isAbsolute(folder) || posix.isAbsolute(folder)) ? folder : null;
}

