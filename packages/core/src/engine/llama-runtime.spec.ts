/**
 * The Visual C++ runtime llama.cpp needs on Windows (msvcp140, vcruntime140, vcruntime140_1): its official release
 * does not carry it, and a Windows without it stops the server before its first line (0xC0000135). bonaparte carries
 * the runtime and puts it beside the llama.cpp it installed — only where Windows has none as recent, so that a runtime
 * Windows Update keeps current is the one that runs.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RUNTIME_FILES,
  compareVersions,
  ensureLlamaRuntime,
  peFileVersion,
  runtimeStatus,
  stopReason,
} from './llama-runtime.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-runtime-'));
  dirs.push(dir);
  return dir;
}

/** A file as a DLL carries its version: VS_FIXEDFILEINFO's signature, then the file version's two words. */
function dll(version: [number, number, number, number], tag = ''): Buffer {
  const head = Buffer.from(`MZ fake ${tag} `.padEnd(64, '.'));
  const info = Buffer.alloc(52);
  info.writeUInt32LE(0xfeef04bd, 0);
  info.writeUInt32LE(0x00010000, 4);
  info.writeUInt32LE(((version[0] << 16) | version[1]) >>> 0, 8);
  info.writeUInt32LE(((version[2] << 16) | version[3]) >>> 0, 12);
  return Buffer.concat([head, info, Buffer.from('tail')]);
}

async function runtimeIn(dir: string, version: [number, number, number, number], tag = ''): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const name of RUNTIME_FILES) await writeFile(join(dir, name), dll(version, tag));
}

describe('a DLL’s version', () => {
  it('is read from its VS_FIXEDFILEINFO', () => {
    expect(peFileVersion(dll([14, 51, 36247, 0]))).toEqual([14, 51, 36247, 0]);
    expect(peFileVersion(Buffer.from('no version here'))).toBeNull();
  });

  it.runIf(process.platform === 'win32' && existsSync('C:\\Windows\\System32\\vcruntime140.dll'))(
    'is read from a real runtime of Windows',
    async () => {
      const version = peFileVersion(await readFile('C:\\Windows\\System32\\vcruntime140.dll'));
      expect(version?.[0]).toBe(14);
    },
  );

  it('compares part by part', () => {
    expect(compareVersions([14, 51, 36247, 0], [14, 50, 35719, 0])).toBeGreaterThan(0);
    expect(compareVersions([14, 44, 35211, 0], [14, 50, 1, 0])).toBeLessThan(0);
    expect(compareVersions([14, 50, 35719, 0], [14, 50, 35719, 0])).toBe(0);
  });
});

describe('the runtime beside the llama.cpp bonaparte installed', () => {
  async function setup(): Promise<{ bin: string; bundled: string; system: string }> {
    const root = await folder();
    const bin = join(root, 'llama.cpp', 'b12383');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'llama-server.exe'), 'server');
    return { bin, bundled: join(root, 'bundled'), system: join(root, 'System32') };
  }

  it('is put there when Windows has none: the server would stop before its first line', async () => {
    const { bin, bundled, system } = await setup();
    await runtimeIn(bundled, [14, 51, 36247, 0], 'ours');
    await mkdir(system, { recursive: true });
    const result = await ensureLlamaRuntime({ binaryDir: bin, bundledDir: bundled, systemDir: system, platform: 'win32', arch: 'x64' });
    expect(result).toBe('copied');
    for (const name of RUNTIME_FILES) expect((await readFile(join(bin, name))).toString()).toContain('ours');
  });

  it('is put there when Windows’ own is older than the one bonaparte carries', async () => {
    const { bin, bundled, system } = await setup();
    await runtimeIn(bundled, [14, 51, 36247, 0], 'ours');
    await runtimeIn(system, [14, 29, 30133, 0], 'old');
    expect(await ensureLlamaRuntime({ binaryDir: bin, bundledDir: bundled, systemDir: system, platform: 'win32', arch: 'x64' })).toBe('copied');
  });

  it('is put there when one file of Windows’ own is missing', async () => {
    const { bin, bundled, system } = await setup();
    await runtimeIn(bundled, [14, 51, 36247, 0], 'ours');
    await runtimeIn(system, [14, 51, 36247, 0], 'system');
    await rm(join(system, 'vcruntime140_1.dll'));
    expect(await ensureLlamaRuntime({ binaryDir: bin, bundledDir: bundled, systemDir: system, platform: 'win32', arch: 'x64' })).toBe('copied');
  });

  it('is not put there when Windows’ own is as recent: Windows Update keeps that one current', async () => {
    const { bin, bundled, system } = await setup();
    await runtimeIn(bundled, [14, 50, 35719, 0], 'ours');
    await runtimeIn(system, [14, 51, 36247, 0], 'system');
    expect(await ensureLlamaRuntime({ binaryDir: bin, bundledDir: bundled, systemDir: system, platform: 'win32', arch: 'x64' })).toBe('system');
    for (const name of RUNTIME_FILES) expect(existsSync(join(bin, name))).toBe(false);
  });

  it('is taken away once Windows has one as recent, but only the copy bonaparte made', async () => {
    const { bin, bundled, system } = await setup();
    await runtimeIn(bundled, [14, 50, 35719, 0], 'ours');
    await mkdir(system, { recursive: true });
    expect(await ensureLlamaRuntime({ binaryDir: bin, bundledDir: bundled, systemDir: system, platform: 'win32', arch: 'x64' })).toBe('copied');
    // Windows Update brings a newer runtime: the copy beside the server would hide it.
    await runtimeIn(system, [14, 51, 36247, 0], 'system');
    expect(await ensureLlamaRuntime({ binaryDir: bin, bundledDir: bundled, systemDir: system, platform: 'win32', arch: 'x64' })).toBe('system');
    for (const name of RUNTIME_FILES) expect(existsSync(join(bin, name))).toBe(false);
  });

  it('never takes away a runtime the package carried itself', async () => {
    const { bin, bundled, system } = await setup();
    await runtimeIn(bin, [14, 40, 1, 0], 'package');
    await runtimeIn(bundled, [14, 50, 35719, 0], 'ours');
    await runtimeIn(system, [14, 51, 36247, 0], 'system');
    await ensureLlamaRuntime({ binaryDir: bin, bundledDir: bundled, systemDir: system, platform: 'win32', arch: 'x64' });
    expect((await readFile(join(bin, 'msvcp140.dll'))).toString()).toContain('package');
  });

  it('is renewed when bonaparte carries a newer one than the copy it made', async () => {
    const { bin, bundled, system } = await setup();
    await mkdir(system, { recursive: true });
    await runtimeIn(bundled, [14, 50, 35719, 0], 'first');
    await ensureLlamaRuntime({ binaryDir: bin, bundledDir: bundled, systemDir: system, platform: 'win32', arch: 'x64' });
    await runtimeIn(bundled, [14, 51, 36247, 0], 'second');
    expect(await ensureLlamaRuntime({ binaryDir: bin, bundledDir: bundled, systemDir: system, platform: 'win32', arch: 'x64' })).toBe('copied');
    expect((await readFile(join(bin, 'msvcp140.dll'))).toString()).toContain('second');
  });

  it('is left as it is when nothing is to change', async () => {
    const { bin, bundled, system } = await setup();
    await runtimeIn(bundled, [14, 51, 36247, 0], 'ours');
    await mkdir(system, { recursive: true });
    await ensureLlamaRuntime({ binaryDir: bin, bundledDir: bundled, systemDir: system, platform: 'win32', arch: 'x64' });
    expect(await ensureLlamaRuntime({ binaryDir: bin, bundledDir: bundled, systemDir: system, platform: 'win32', arch: 'x64' })).toBe('local');
  });

  it('a copy cut halfway is still bonaparte’s: taken away once Windows has a runtime as recent', async () => {
    const { bin, bundled, system } = await setup();
    await runtimeIn(bundled, [14, 51, 36247, 0], 'ours');
    await mkdir(system, { recursive: true });
    // The last file cannot be written (a folder of that name): the copy stops after the first two.
    await mkdir(join(bin, 'vcruntime140_1.dll'));
    expect(await ensureLlamaRuntime({ binaryDir: bin, bundledDir: bundled, systemDir: system, platform: 'win32', arch: 'x64' })).toBe('failed');
    expect(existsSync(join(bin, 'msvcp140.dll'))).toBe(true);
    await rm(join(bin, 'vcruntime140_1.dll'), { recursive: true });
    await runtimeIn(system, [14, 51, 36247, 0], 'system');
    expect(await ensureLlamaRuntime({ binaryDir: bin, bundledDir: bundled, systemDir: system, platform: 'win32', arch: 'x64' })).toBe('system');
    expect(existsSync(join(bin, 'msvcp140.dll'))).toBe(false);
  });

  it('never touches a package that carries even one runtime file of its own', async () => {
    const { bin, bundled, system } = await setup();
    await writeFile(join(bin, 'vcruntime140.dll'), dll([14, 40, 1, 0], 'package'));
    await runtimeIn(bundled, [14, 51, 36247, 0], 'ours');
    await mkdir(system, { recursive: true });
    expect(await ensureLlamaRuntime({ binaryDir: bin, bundledDir: bundled, systemDir: system, platform: 'win32', arch: 'x64' })).toBe('package');
    expect((await readFile(join(bin, 'vcruntime140.dll'))).toString()).toContain('package');
    expect(existsSync(join(bin, 'msvcp140.dll'))).toBe(false);
  });

  it('puts nothing beside a llama.cpp that is not x64: the runtime carried is x64’s', async () => {
    const { bin, bundled, system } = await setup();
    await runtimeIn(bundled, [14, 51, 36247, 0], 'ours');
    await mkdir(system, { recursive: true });
    expect(await ensureLlamaRuntime({ binaryDir: bin, bundledDir: bundled, systemDir: system, platform: 'win32', arch: 'arm64' })).toBe('not-x64');
    expect(existsSync(join(bin, 'msvcp140.dll'))).toBe(false);
  });

  it('does nothing elsewhere than Windows, nor without a runtime carried', async () => {
    const { bin, bundled, system } = await setup();
    await runtimeIn(bundled, [14, 51, 36247, 0]);
    expect(await ensureLlamaRuntime({ binaryDir: bin, bundledDir: bundled, systemDir: system, platform: 'linux' })).toBe('not-windows');
    expect(await ensureLlamaRuntime({ binaryDir: bin, bundledDir: undefined, systemDir: system, platform: 'win32', arch: 'x64' })).toBe('nothing-carried');
    expect(await ensureLlamaRuntime({ binaryDir: bin, bundledDir: join(bin, 'nowhere'), systemDir: system, platform: 'win32', arch: 'x64' })).toBe('nothing-carried');
  });
});

describe('what doctor says of the runtime', () => {
  it('names each runtime there is: Windows’ own, the one bonaparte carries, the one beside llama.cpp', async () => {
    const root = await folder();
    const system = join(root, 'System32');
    const bundled = join(root, 'bundled');
    const bin = join(root, 'llama.cpp', 'b12383');
    await runtimeIn(system, [14, 51, 36247, 0]);
    await runtimeIn(bundled, [14, 50, 35719, 0]);
    await mkdir(bin, { recursive: true });
    const place = { systemDir: system, bundledDir: bundled, binaryDir: bin, platform: 'win32' as const, arch: 'x64' };
    expect(await runtimeStatus(place)).toEqual({ system: '14.51.36247.0', carried: '14.50.35719.0', beside: null });
    await runtimeIn(bin, [14, 50, 35719, 0]);
    await rm(join(system, 'msvcp140.dll'));
    expect(await runtimeStatus({ ...place, bundledDir: undefined })).toEqual({ system: null, carried: null, beside: '14.50.35719.0' });
    // The runtime carried is x64's: on another machine it counts for nothing.
    expect((await runtimeStatus({ ...place, arch: 'arm64' }))?.carried).toBeNull();
    expect(await runtimeStatus({ ...place, platform: 'linux' })).toBeNull();
  });
});

describe('why llama-server stopped before it was ready', () => {
  it('a library Windows could not find: 0xC0000135, however Node gives the code', () => {
    expect(stopReason(0xc0000135, '')).toBe('missing-library');
    expect(stopReason(-1073741515, '')).toBe('missing-library');
  });

  it('a library too old for it: 0xC0000139, an entry point not found', () => {
    expect(stopReason(0xc0000139, '')).toBe('old-library');
  });

  it('nothing written: said as silence, its code kept', () => {
    expect(stopReason(1, '')).toBe('silent');
    expect(stopReason(null, '')).toBe('silent');
  });

  it('its own words otherwise', () => {
    expect(stopReason(1, 'error: cannot load the model')).toBe('said');
  });
});
