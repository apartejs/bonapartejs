/**
 * Installing a llama.cpp build: downloaded, verified, unpacked by the
 * system's own `tar` (Windows ships one that reads zip), the server found in
 * the package, and the install recorded — or nothing at all.
 */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runShort } from './process-probe.js';
import { installedLlama, installLlama, tarCommand } from './llama-install.js';
import type { LlamaAsset } from './llama-release.js';

const EXE = process.platform === 'win32' ? '.exe' : '';

let servers: Server[] = [];
let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  servers = [];
  dirs = [];
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-llama-'));
  dirs.push(dir);
  return dir;
}

/** A package as llama.cpp publishes one: the server and its libraries, in a folder. */
async function makePackage(files: Record<string, string>): Promise<Buffer> {
  const root = await folder();
  const content = join(root, 'content');
  for (const [name, text] of Object.entries(files)) {
    await mkdir(join(content, name, '..'), { recursive: true });
    await writeFile(join(content, name), text);
  }
  const archive = join(root, 'package.tar.gz');
  const ran = await runShort(tarCommand(process.platform, process.env), ['-czf', archive, '-C', content, '.'], 30_000);
  if (ran?.code !== 0) throw new Error(`tar could not pack the test package: ${ran?.stdout}`);
  return readFile(archive);
}

async function serve(body: Buffer, build = 'b12383'): Promise<LlamaAsset> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-length': body.length });
    res.end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const name = `llama-${build}-bin-win-vulkan-x64.zip`;
  return {
    build,
    name,
    url: `http://127.0.0.1:${port}/${name}`,
    bytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
  };
}

describe('installLlama', () => {
  it('downloads, verifies, unpacks, and finds the server in the package', async () => {
    const asset = await serve(await makePackage({ [`build/bin/llama-server${EXE}`]: 'server', 'build/bin/ggml-vulkan.dll': 'lib' }));
    const dir = await folder();
    const installed = await installLlama({ dir, asset });
    expect(installed).toMatchObject({ build: 'b12383', asset: asset.name, sha256: asset.sha256 });
    expect(installed.binary).toBe(join(dir, 'b12383', 'build', 'bin', `llama-server${EXE}`));
    expect(await readFile(installed.binary, 'utf8')).toBe('server');
    expect(await installedLlama(dir)).toEqual(installed);
    // The archive does not stay: only the unpacked build.
    expect((await readdir(join(dir, 'downloads'))).filter((name) => !name.endsWith('.part'))).toEqual([]);
  });

  it('takes the unified CLI when the package has no llama-server', async () => {
    const asset = await serve(await makePackage({ [`llama${EXE}`]: 'cli' }));
    const dir = await folder();
    expect((await installLlama({ dir, asset })).binary).toBe(join(dir, 'b12383', `llama${EXE}`));
  });

  it('installs nothing when the digest is not the one announced', async () => {
    const asset = await serve(await makePackage({ [`llama-server${EXE}`]: 'server' }));
    const dir = await folder();
    await expect(installLlama({ dir, asset: { ...asset, sha256: '0'.repeat(64) } })).rejects.toThrow(/SHA-256/);
    expect(await installedLlama(dir)).toBeNull();
    expect((await readdir(dir)).filter((name) => name.startsWith('b'))).toEqual([]);
  });

  it('refuses a package without a llama.cpp server in it, and installs nothing', async () => {
    const asset = await serve(await makePackage({ 'README.md': 'nothing to run' }));
    const dir = await folder();
    await expect(installLlama({ dir, asset })).rejects.toThrow(/no llama.cpp server/);
    expect(await installedLlama(dir)).toBeNull();
  });

  it('a newer build replaces the one before it', async () => {
    const dir = await folder();
    await installLlama({ dir, asset: await serve(await makePackage({ [`llama-server${EXE}`]: 'old' }), 'b100') });
    const newer = await installLlama({ dir, asset: await serve(await makePackage({ [`llama-server${EXE}`]: 'new' }), 'b200') });
    expect(await installedLlama(dir)).toEqual(newer);
    expect((await readdir(dir)).filter((name) => /^b\d+$/.test(name))).toEqual(['b200']);
  });

  it('forgets an install whose server is gone (removed by hand, or by an antivirus)', async () => {
    const dir = await folder();
    const installed = await installLlama({ dir, asset: await serve(await makePackage({ [`llama-server${EXE}`]: 'x' })) });
    await rm(installed.binary);
    expect(await installedLlama(dir)).toBeNull();
  });
});

describe('tarCommand', () => {
  it("is Windows' own tar on Windows — never another one first on the PATH (Git's cannot read zip)", () => {
    expect(tarCommand('win32', { SystemRoot: 'C:\\Windows' })).toBe(join('C:\\Windows', 'System32', 'tar.exe'));
    expect(tarCommand('linux', {})).toBe('tar');
  });
});
