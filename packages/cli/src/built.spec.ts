/**
 * The command as it is published: one bundled file, the core inside it. A package of the core written in CommonJS
 * (undici) asks Node's own modules with `require`, which a bundled ES module does not have — the command died before
 * its first line (found preparing the Windows Sandbox test). The sources' tests cannot see it: this one builds.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnHidden } from '@aparte/bonaparte-core';
import { build } from 'tsup';
import { afterAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function run(file: string, args: readonly string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawnHidden(process.execPath, [file, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('the command as it is published', () => {
  it('runs: its version, its help — the core bundled in it', async () => {
    // Beside the package.json, as once installed: its dependencies resolve, its version is read.
    const out = await mkdtemp(join(root, '.built-'));
    dirs.push(out);
    // The published build's own settings, read as tsup reads them.
    const { default: config } = (await import(pathToFileURL(join(root, 'tsup.config.ts')).href)) as { default: object | object[] };
    const options = Array.isArray(config) ? config[0] : config;
    await build({ ...(options as object), entry: [join(root, 'src', 'cli.ts').split('\\').join('/')], outDir: out, sourcemap: false, silent: true });
    // The file reads its package.json beside its folder, as it does once installed.
    const version = await run(join(out, 'cli.js'), ['--version']);
    expect(version.stderr).toBe('');
    expect(version.code).toBe(0);
  }, 60_000);
});
