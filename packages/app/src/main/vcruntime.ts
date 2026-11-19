/**
 * Where the Visual C++ runtime the app carries for llama.cpp sits on the disk (`resources/vcruntime`, prepared by
 * `scripts/prepare-vcruntime.mjs` when the app is packed on Windows). llama.cpp is a program of its own: it cannot
 * read inside app.asar, so an installed app reads the copy electron-builder unpacks beside the archive (`asarUnpack`).
 */

import { join } from 'node:path';

export function carriedRuntimeDir(appPath: string, exists: (path: string) => boolean): string | undefined {
  const base = /\.asar$/i.test(appPath) ? `${appPath}.unpacked` : appPath;
  const dir = join(base, 'resources', 'vcruntime');
  return exists(dir) ? dir : undefined;
}
