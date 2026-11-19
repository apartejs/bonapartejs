/**
 * Where the app's Visual C++ runtime comes from when it is packed: Visual Studio's redistributable folder
 * (`VC\Redist\MSVC\<version>\x64\Microsoft.VC14x.CRT`), the only place its licence lets the files be taken from — the
 * newest found, and never one older than what built llama.cpp.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MIN_RUNTIME, findCarriedRuntime } from './vcruntime-source.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

function dll(version: [number, number, number, number]): Buffer {
  const info = Buffer.alloc(16);
  info.writeUInt32LE(0xfeef04bd, 0);
  info.writeUInt32LE(((version[0] << 16) | version[1]) >>> 0, 8);
  info.writeUInt32LE(((version[2] << 16) | version[3]) >>> 0, 12);
  return Buffer.concat([Buffer.from('MZ'.padEnd(64, '.')), info]);
}

async function crt(root: string, year: string, edition: string, folder: string, version: [number, number, number, number], arch = 'x64', files = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']): Promise<string> {
  const dir = join(root, year, edition, 'VC', 'Redist', 'MSVC', folder, arch, `Microsoft.VC${version[1] >= 50 ? 145 : 143}.CRT`);
  await mkdir(dir, { recursive: true });
  for (const name of files) await writeFile(join(dir, name), dll(version));
  return dir;
}

describe('the runtime the app carries, taken from Visual Studio', () => {
  it('is the newest x64 runtime of every Visual Studio installed, read from the DLLs themselves', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bp-vs-'));
    dirs.push(root);
    await crt(root, '2022', 'BuildTools', '14.44.35112', [14, 44, 35211, 0]);
    const newest = await crt(root, '18', 'Community', '14.51.36231', [14, 51, 36247, 0]);
    await crt(root, '18', 'Community', '14.52.1', [14, 52, 1, 0], 'arm64');
    await crt(root, '18', 'Preview', '14.53.1', [14, 53, 1, 0], 'x64', ['msvcp140.dll']);
    expect(await findCarriedRuntime([root, join(root, 'nowhere')])).toEqual({ dir: newest, version: [14, 51, 36247, 0] });
  });

  it('is none when no Visual Studio has one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bp-vs-'));
    dirs.push(root);
    expect(await findCarriedRuntime([root])).toBeNull();
  });

  it('may not be older than what built llama.cpp’s package: MSVC 14.51 linked b12383', () => {
    expect(MIN_RUNTIME).toEqual([14, 51]);
  });
});
