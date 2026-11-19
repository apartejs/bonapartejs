/**
 * The Visual C++ runtime llama.cpp needs on Windows. Every binary of its official release imports msvcp140,
 * vcruntime140 and vcruntime140_1 and the package carries none: on a Windows without them (a fresh install, Windows
 * Sandbox) the server stops before its first line, with 0xC0000135. bonaparte carries the runtime (taken from Visual
 * Studio's redistributable folder when the app is built) and puts it beside the llama.cpp it installed — only when
 * Windows has none as recent. Windows looks for a library in the program's own folder before System32, so a copy
 * there would hide a runtime Windows Update keeps current: once Windows has one as recent, the copy bonaparte made is
 * taken away. A runtime the package carried itself is never touched.
 */

import { copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const RUNTIME_FILES = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'] as const;

/** Which runtime bonaparte copied beside a llama.cpp: only what it wrote is ever taken away. */
const MARK = 'bonaparte-runtime.json';

export type Version = [number, number, number, number];

/** A PE file's version, from its VS_FIXEDFILEINFO (signature 0xFEEF04BD, then the file version's two words). */
export function peFileVersion(file: Buffer): Version | null {
  const at = file.indexOf(Buffer.from([0xbd, 0x04, 0xef, 0xfe]));
  if (at < 0 || at + 16 > file.length) return null;
  const high = file.readUInt32LE(at + 8);
  const low = file.readUInt32LE(at + 12);
  return [high >>> 16, high & 0xffff, low >>> 16, low & 0xffff];
}

export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

const shown = (version: Version): string => version.join('.');

/** Each runtime file's version in a folder; null when one is missing or unreadable. */
async function versionsIn(dir: string | undefined): Promise<Version[] | null> {
  if (!dir) return null;
  const versions: Version[] = [];
  for (const name of RUNTIME_FILES) {
    const file = await readFile(join(dir, name)).catch(() => null);
    const version = file ? peFileVersion(file) : null;
    if (!version) return null;
    versions.push(version);
  }
  return versions;
}

/** The oldest of the set: what a runtime "as recent" is measured by. */
function oldest(versions: Version[]): Version {
  return versions.reduce((a, b) => (compareVersions(a, b) <= 0 ? a : b));
}

export interface RuntimePlace {
  /** The folder of the llama.cpp bonaparte installed (its llama-server.exe). */
  binaryDir: string;
  /** The runtime bonaparte carries; absent in a development checkout that did not prepare it. */
  bundledDir: string | undefined;
  /** Windows' own (`%SystemRoot%\System32`). */
  systemDir: string;
  platform: NodeJS.Platform;
  /** The machine's architecture, which the llama.cpp installed is built for: the runtime carried is x64's. */
  arch?: string;
}

export type RuntimeOutcome =
  | 'not-windows'
  /** A llama.cpp for another architecture (arm64): the x64 runtime carried would not load beside it. */
  | 'not-x64'
  | 'nothing-carried'
  /** Windows' own is as recent: it runs, serviced by Windows Update. */
  | 'system'
  /** The copy bonaparte made is there and current. */
  | 'local'
  /** The package carried a runtime file of its own: left alone. */
  | 'package'
  | 'copied'
  /** A copy or a removal failed (a file in use): llama.cpp runs with what is there, and says it if it cannot. */
  | 'failed';

/** Any runtime file readable in the folder: a package that carries even one is left as it is. */
async function anyRuntimeIn(dir: string): Promise<boolean> {
  for (const name of RUNTIME_FILES) {
    if (await readFile(join(dir, name)).then(() => true, () => false)) return true;
  }
  return false;
}

export async function ensureLlamaRuntime(place: RuntimePlace): Promise<RuntimeOutcome> {
  if (place.platform !== 'win32') return 'not-windows';
  if ((place.arch ?? process.arch) !== 'x64') return 'not-x64';
  const carried = await versionsIn(place.bundledDir);
  if (!carried || !place.bundledDir) return 'nothing-carried';
  const ours = await readFile(join(place.binaryDir, MARK), 'utf8').then(
    () => true,
    () => false,
  );
  if (!ours && (await anyRuntimeIn(place.binaryDir))) return 'package';
  const local = await versionsIn(place.binaryDir);

  const system = await versionsIn(place.systemDir);
  const systemRecentEnough = system !== null && system.every((version, i) => compareVersions(version, carried[i]!) >= 0);
  try {
    if (systemRecentEnough) {
      if (ours) {
        // The mark last: a removal cut halfway is finished at the next start.
        for (const name of RUNTIME_FILES) await rm(join(place.binaryDir, name), { force: true });
        await rm(join(place.binaryDir, MARK), { force: true });
      }
      return 'system';
    }
    if (ours && local && local.every((version, i) => compareVersions(version, carried[i]!) === 0)) return 'local';
    // The mark first: a copy cut halfway is still bonaparte's, renewed or taken away later — never taken for the
    // package's own.
    await writeFile(join(place.binaryDir, MARK), `${JSON.stringify({ version: shown(oldest(carried)), files: RUNTIME_FILES }, null, 2)}\n`);
    for (const name of RUNTIME_FILES) await copyFile(join(place.bundledDir, name), join(place.binaryDir, name));
    return 'copied';
  } catch {
    return 'failed';
  }
}

export interface RuntimeStatus {
  /** Windows' own runtime. */
  system: string | null;
  /** The one bonaparte carries (null when none, or for a machine that is not x64). */
  carried: string | null;
  /** The one beside the llama.cpp found: bonaparte's copy, or the package's own. */
  beside: string | null;
}

/** What `bonaparte doctor` says: each runtime there is, as a version (null when incomplete). */
export async function runtimeStatus(place: Omit<RuntimePlace, 'binaryDir'> & { binaryDir?: string }): Promise<RuntimeStatus | null> {
  if (place.platform !== 'win32') return null;
  const x64 = (place.arch ?? process.arch) === 'x64';
  const system = await versionsIn(place.systemDir);
  const carried = x64 ? await versionsIn(place.bundledDir) : null;
  const beside = await versionsIn(place.binaryDir);
  return {
    system: system ? shown(oldest(system)) : null,
    carried: carried ? shown(oldest(carried)) : null,
    beside: beside ? shown(oldest(beside)) : null,
  };
}

/** Windows' status codes for a program its loader could not start (Node gives them signed or not). */
const STATUS_DLL_NOT_FOUND = 0xc0000135;
const STATUS_ENTRYPOINT_NOT_FOUND = 0xc0000139;

export type StopReason = 'said' | 'missing-library' | 'old-library' | 'silent';

/**
 * Why llama-server stopped before it was ready. Its own words come first; without them, the code Windows gave says
 * whether a library was missing (0xC0000135: the Visual C++ runtime, as llama.cpp's package imports no other that
 * Windows lacks) or too old for it (0xC0000139: an entry point not found).
 */
export function stopReason(code: number | null, said: string): StopReason {
  if (said.trim() !== '') return 'said';
  if (code === null) return 'silent';
  const status = code >>> 0;
  if (status === STATUS_DLL_NOT_FOUND) return 'missing-library';
  if (status === STATUS_ENTRYPOINT_NOT_FOUND) return 'old-library';
  return 'silent';
}
