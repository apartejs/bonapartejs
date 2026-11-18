/**
 * What an end-to-end test may change in the engine, read from the
 * environment in a test run (`BONAPARTE_E2E=1`) and only then: what to
 * launch instead of llama.cpp (the fake binary), the video memory the card
 * is said to have, the port of the managed server, and where llama.cpp's
 * releases are read — a local server of the test, never GitHub.
 */

import { posix, win32 } from 'node:path';
import type { CatalogueEntry, CoreDeps } from '@aparte/bonaparte-core';

export function e2eEngineDeps(
  env: Record<string, string | undefined>,
  e2e: boolean,
): Pick<CoreDeps, 'llamaCommand' | 'gpuMemory' | 'freeDiskBytes' | 'port' | 'llamaReleases' | 'home' | 'diskRoots' | 'gh' | 'modelHub' | 'modelCatalogue'> {
  if (!e2e) return {};
  // GitHub's CLI: the test's fake one, or none — a test run never asks GitHub.
  const deps: Pick<CoreDeps, 'llamaCommand' | 'gpuMemory' | 'freeDiskBytes' | 'port' | 'llamaReleases' | 'home' | 'diskRoots' | 'gh' | 'modelHub' | 'modelCatalogue'> = { gh: null };
  try {
    const gh = JSON.parse(env['BONAPARTE_E2E_GH_COMMAND'] ?? 'null') as unknown;
    if (Array.isArray(gh) && gh.length > 0 && gh.every((part) => typeof part === 'string')) deps.gh = gh as string[];
  } catch {
    /* not a command: none */
  }
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
  // The free space a test says the disk has (task 12.3: the disk nearly full).
  const free = Number(env['BONAPARTE_E2E_FREE_BYTES']);
  if (Number.isFinite(free) && free >= 0 && env['BONAPARTE_E2E_FREE_BYTES'] !== undefined) deps.freeDiskBytes = async () => free;
  const port = Number(env['BONAPARTE_E2E_ENGINE_PORT']);
  if (Number.isInteger(port) && port > 0 && port < 65536) deps.port = port;
  // « Chercher sur tout le disque »: the test's folder, never the person's drives.
  const disk = env['BONAPARTE_E2E_DISK_ROOT'];
  if (disk && (win32.isAbsolute(disk) || posix.isAbsolute(disk))) deps.diskRoots = async () => [disk];
  const releases = env['BONAPARTE_E2E_LLAMA_RELEASES'];
  deps.llamaReleases = releases && /^http:\/\/127\.0\.0\.1:\d+\//.test(releases) ? releases : null;
  // The models recommended: the test's hub (and its catalogue), never Hugging Face (task 9.5).
  const hub = env['BONAPARTE_E2E_MODEL_HUB'];
  deps.modelHub = hub && /^http:\/\/127\.0\.0\.1:\d+$/.test(hub) ? hub : null;
  // Without the test's hub, nothing is recommended: no button may point at Hugging Face.
  deps.modelCatalogue = (deps.modelHub ? catalogueOf(env['BONAPARTE_E2E_MODEL_CATALOGUE']) : undefined) ?? [];
  return deps;
}

function catalogueOf(text: string | undefined): CatalogueEntry[] | undefined {
  let read: unknown;
  try {
    read = JSON.parse(text ?? 'null');
  } catch {
    return undefined;
  }
  if (!Array.isArray(read)) return undefined;
  const isEntry = (one: unknown): one is CatalogueEntry => {
    const entry = one as Record<string, unknown>;
    return (
      typeof one === 'object' &&
      one !== null &&
      ['id', 'name', 'repo', 'file'].every((key) => typeof entry[key] === 'string') &&
      (entry['family'] === 'gemma' || entry['family'] === 'qwen') &&
      typeof entry['sha256'] === 'string' &&
      /^[0-9a-f]{64}$/.test(entry['sha256']) &&
      ['bytes', 'context', 'fromGiB'].every((key) => typeof entry[key] === 'number')
    );
  };
  return read.filter(isEntry);
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


/**
 * The search engine the hidden page reads (task 10.4): outside a test run, the public one (`undefined`); in a
 * test run, only a local engine of the test (`BONAPARTE_E2E_SEARCH_ENGINE`), else none (`null`) — a test run
 * never asks the internet.
 */
export function e2eSearchEngine(env: Record<string, string | undefined>, e2e: boolean): string | null | undefined {
  if (!e2e) return undefined;
  const engine = env['BONAPARTE_E2E_SEARCH_ENGINE'];
  return engine && /^http:\/\/127\.0\.0\.1:\d+\//.test(engine) ? engine : null;
}
