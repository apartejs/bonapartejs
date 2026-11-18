/**
 * llama.cpp not found (task 12.3, board « Quand quelque chose casse », « Au premier lancement »): the person may
 * choose their own. A file is kept only when it answers `--version` as llama.cpp does; it is then the one a load
 * runs. And « Une partie sur le processeur » is read at the very next launch, not after a restart of the app.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, type Core } from '../api.js';
import type { SpawnFn } from '../process/spawn.js';

const BIN = fileURLToPath(new URL('../testing/fake-llama-bin.mjs', import.meta.url));
const cores: Core[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop().catch(() => undefined);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
});

async function rig() {
  const dataDir = await mkdtemp(join(tmpdir(), 'bp-llama-pick-'));
  dirs.push(dataDir);
  await mkdir(join(dataDir, 'bin'), { recursive: true });
  // A file the person picks: the test runs the fake binary in its place.
  const llama = join(dataDir, 'bin', 'llama-server.exe');
  await writeFile(llama, 'fake');
  const notLlama = join(dataDir, 'bin', 'notes.txt');
  await writeFile(notLlama, 'not a program');
  const spawn: SpawnFn = (command, args, options) =>
    command === llama ? nodeSpawn(process.execPath, [BIN, ...args], options) : nodeSpawn(command, [...args], options);
  const core = createCore({ dataDir, env: {}, spawn, llamaReleases: null, logger: () => undefined, gpuMemory: async () => 24 * 1024 ** 3 });
  cores.push(core);
  return { core, dataDir, llama, notLlama };
}

describe('a llama.cpp the person chooses', () => {
  it('is kept when it answers as llama.cpp does, and is then the one the engine runs', async () => {
    const { core, dataDir, llama } = await rig();
    const state = await core.useLlamaBinary(llama);
    expect(state.current).toMatchObject({ source: 'configured', build: 'b9999' });
    const config = JSON.parse(await readFile(join(dataDir, 'config', 'global.json'), 'utf8'));
    expect(config.backend).toEqual({ mode: 'managed', binPath: llama });
  });

  it('is refused when it is no llama.cpp, nothing kept; a path that is not absolute too', async () => {
    const { core, notLlama } = await rig();
    await expect(core.useLlamaBinary(notLlama)).rejects.toThrow(/llama\.cpp/);
    await expect(core.useLlamaBinary('llama-server.exe')).rejects.toThrow(/absolute/);
    expect((await core.llamaCpp()).current?.source).not.toBe('configured');
  });
});
