/**
 * The llama.cpp build bonaparte keeps itself, under `<data>/llama.cpp/`:
 * downloaded, verified against its digest, unpacked by the system's own
 * `tar`, its server found in the package, and the install written down in
 * `installed.json` — or nothing at all. One build is kept: a newer one
 * replaces it, never in silence (the window asks first).
 */

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { downloadFile } from '../models/download.js';
import type { SpawnFn } from '../process/spawn.js';
import { BUILD_TAG, type LlamaAsset } from './llama-release.js';
import { runShort } from './process-probe.js';

export interface InstalledLlama {
  build: string;
  /** The server to launch: llama-server, or the unified CLI. */
  binary: string;
  asset: string;
  sha256: string;
  installedAt: string;
}

const RECORD = 'installed.json';

/**
 * Windows' own tar (bsdtar, which reads zip) — by its full path: another
 * `tar` first on the PATH (Git's) cannot. Elsewhere the system's.
 */
export function tarCommand(platform: NodeJS.Platform, env: Record<string, string | undefined>): string {
  return platform === 'win32' ? join(env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
}

/** The server in an unpacked package: llama-server first, else the unified CLI. */
async function findServer(root: string): Promise<string | null> {
  const found: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && depth < 4) await walk(path, depth + 1);
      else if (entry.isFile()) found.push(path);
    }
  }
  await walk(root, 0);
  const named = (name: string) => found.find((path) => /[\\/]([^\\/]+)$/.exec(path)?.[1]?.toLowerCase() === name);
  return named('llama-server.exe') ?? named('llama-server') ?? named('llama.exe') ?? named('llama') ?? null;
}

/** The build installed, or null — when nothing is, or its server is gone. */
export async function installedLlama(dir: string): Promise<InstalledLlama | null> {
  try {
    const record = JSON.parse(await readFile(join(dir, RECORD), 'utf8')) as Omit<InstalledLlama, 'binary'> & { binary: string };
    const binary = join(dir, record.binary);
    if (!(await stat(binary)).isFile()) return null;
    return { ...record, binary };
  } catch {
    return null;
  }
}

export interface InstallOptions {
  /** `<data>/llama.cpp` */
  dir: string;
  asset: LlamaAsset;
  fetch?: typeof globalThis.fetch;
  spawn?: SpawnFn;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  onProgress?: (progress: { done: number; total: number | null }) => void;
}

export async function installLlama(options: InstallOptions): Promise<InstalledLlama> {
  const { dir, asset } = options;
  // Both become paths under `dir`: checked here too, whatever the release said.
  if (!BUILD_TAG.test(asset.build)) throw new Error(`This is not a llama.cpp build: ${asset.build}`);
  if (!/^[\w.-]+\.(zip|tar\.gz)$/.test(asset.name) || asset.name.includes('..')) {
    throw new Error(`This is not a llama.cpp package: ${asset.name}`);
  }
  const downloads = join(dir, 'downloads');
  await mkdir(downloads, { recursive: true });
  const archive = join(downloads, asset.name);
  await downloadFile({
    url: asset.url,
    dest: archive,
    sha256: asset.sha256,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });

  const unpacking = join(dir, `${asset.build}.unpacking`);
  await rm(unpacking, { recursive: true, force: true });
  await mkdir(unpacking, { recursive: true });
  try {
    const tar = tarCommand(options.platform ?? process.platform, options.env ?? process.env);
    const ran = await runShort(tar, ['-xf', archive, '-C', unpacking], 300_000, options.spawn);
    if (ran?.code !== 0) throw new Error(`The llama.cpp package could not be unpacked.${ran?.stdout ? `\n${ran.stdout}` : ''}`);
    const server = await findServer(unpacking);
    if (!server) throw new Error(`There is no llama.cpp server in ${asset.name}.`);

    const target = join(dir, asset.build);
    await rm(target, { recursive: true, force: true });
    await rename(unpacking, target);
    const record = {
      build: asset.build,
      binary: join(asset.build, relative(unpacking, server)),
      asset: asset.name,
      sha256: asset.sha256,
      installedAt: new Date().toISOString(),
    };
    await writeFile(join(dir, RECORD), `${JSON.stringify(record, null, 2)}\n`);
    await rm(archive, { force: true });
    // The build before it: removed when it can be (a running one keeps its files on Windows).
    for (const entry of await readdir(dir)) {
      if (/^b\d+(\.unpacking)?$/.test(entry) && entry !== asset.build) {
        await rm(join(dir, entry), { recursive: true, force: true }).catch(() => undefined);
      }
    }
    return { ...record, binary: join(dir, record.binary) };
  } catch (error) {
    await rm(unpacking, { recursive: true, force: true });
    throw error;
  }
}
