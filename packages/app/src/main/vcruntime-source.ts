/**
 * Where the Visual C++ runtime the app carries for llama.cpp comes from when the app is packed on Windows: Visual
 * Studio's redistributable folder, `<Visual Studio>\VC\Redist\MSVC\<version>\x64\Microsoft.VC14x.CRT`. Its licence lets
 * those files — and only those, unmodified — travel with an application (the Distributable List of Visual Studio,
 * "Visual C++ Runtime Files"); a copy taken from System32 or from vc_redist may not. Microsoft supports a runtime only
 * as recent as, or newer than, the toolset that built the program: the newest found is taken, and one older than what
 * built llama.cpp's package is carried with a warning (a runtime one step behind serves a Windows that has none; one
 * too old says so when llama.cpp stops, with Microsoft's installer).
 *
 * Plain TypeScript with no import of the app: `scripts/prepare-vcruntime.mjs` runs it with Node's own type stripping.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const RUNTIME_FILES = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'] as const;

/**
 * The runtime the app should carry at least (an older one is warned of): llama.cpp b12383's ggml-vulkan.dll was linked
 * by MSVC 14.51 (its PE header).
 * A newer llama.cpp built by a newer toolset raises it.
 */
export const MIN_RUNTIME: readonly [number, number] = [14, 51];

export type Version = [number, number, number, number];

export function peFileVersion(file: Buffer): Version | null {
  const at = file.indexOf(Buffer.from([0xbd, 0x04, 0xef, 0xfe]));
  if (at < 0 || at + 16 > file.length) return null;
  const high = file.readUInt32LE(at + 8);
  const low = file.readUInt32LE(at + 12);
  return [high >>> 16, high & 0xffff, low >>> 16, low & 0xffff];
}

export function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

const children = (dir: string): Promise<string[]> => readdir(dir).catch(() => []);

/** The runtime of one CRT folder: the oldest of its three files, or null when one is missing. */
async function runtimeIn(dir: string): Promise<Version | null> {
  let oldest: Version | null = null;
  for (const name of RUNTIME_FILES) {
    const file = await readFile(join(dir, name)).catch(() => null);
    const version = file ? peFileVersion(file) : null;
    if (!version) return null;
    if (!oldest || compareVersions(version, oldest) < 0) oldest = version;
  }
  return oldest;
}

/** The newest x64 runtime under the Visual Studio roots given (each `...\Microsoft Visual Studio`). */
export async function findCarriedRuntime(roots: readonly string[]): Promise<{ dir: string; version: Version } | null> {
  let best: { dir: string; version: Version } | null = null;
  for (const root of roots) {
    for (const year of await children(root)) {
      for (const edition of await children(join(root, year))) {
        const msvc = join(root, year, edition, 'VC', 'Redist', 'MSVC');
        for (const toolset of await children(msvc)) {
          for (const crt of await children(join(msvc, toolset, 'x64'))) {
            if (!/^Microsoft\.VC\d+\.CRT$/i.test(crt)) continue;
            const dir = join(msvc, toolset, 'x64', crt);
            const version = await runtimeIn(dir);
            if (version && (!best || compareVersions(version, best.version) > 0)) best = { dir, version };
          }
        }
      }
    }
  }
  return best;
}
