/**
 * The core owns the engine. Starting it loads nothing; it lists the models
 * it finds, each with what loading it would cost; it loads one only when
 * asked, and a turn then runs on that engine, in the model's family.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, type Core, type CoreDeps } from './api.js';
import { UnsupportedFamilyError } from './families/index.js';
import type { SpawnedProcess, SpawnFn } from './process/spawn.js';
import { FAKE_QWEN_TEMPLATE, startFakeLlamaServer, type FakeLlamaServer } from './testing/fake-llama-server.js';
import { writeFakeGguf } from './testing/fake-gguf.js';

const BIN = fileURLToPath(new URL('./testing/fake-llama-bin.mjs', import.meta.url));
const GiB = 1024 ** 3;

let cores: Core[] = [];
let dirs: string[] = [];
let servers: FakeLlamaServer[] = [];
afterEach(async () => {
  await Promise.all(cores.map((core) => core.stop()));
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  cores = [];
  dirs = [];
  servers = [];
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

async function setup(overrides: Partial<CoreDeps> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bp-core-'));
  dirs.push(dir);
  const models = join(dir, 'models');
  await mkdir(models, { recursive: true });
  const gemma = join(models, 'gemma-4-test.gguf');
  const qwen = join(models, 'qwen-test.gguf');
  const old = join(models, 'gemma-3-test.gguf');
  const bare = join(models, 'no-template.gguf');
  await writeFakeGguf(gemma, { paddingBytes: 4096 });
  await writeFakeGguf(qwen, { architecture: 'qwen3', chatTemplate: FAKE_QWEN_TEMPLATE });
  await writeFakeGguf(old, { chatTemplate: "{{ '<start_of_turn>' + role }}" });
  await writeFakeGguf(bare, { chatTemplate: null });
  const core = createCore({
    dataDir: join(dir, 'data'),
    env: {},
    llamaCommand: [process.execPath, BIN],
    port: await freePort(),
    modelRoots: [{ dir: models, source: 'custom' }],
    gpuMemory: async () => 24 * GiB,
    logger: () => undefined,
    ...overrides,
  });
  cores.push(core);
  return { core, dir, gemma, qwen, old, bare };
}

describe('createCore — the managed engine', () => {
  it('starting the core loads nothing, and no turn can run', async () => {
    const { core } = await setup();
    expect(await core.engineState()).toMatchObject({ mode: 'managed', status: 'stopped' });
    expect(await core.engine()).toBeUndefined();
  });

  it('asking about the engine runs nothing — not even llama.cpp --version', async () => {
    const { core } = await setup({
      llamaCommand: undefined,
      spawn: () => {
        throw new Error('nothing may be launched');
      },
    });
    expect(await core.engineState()).toMatchObject({ mode: 'managed', status: 'stopped' });
    expect(await core.engine()).toBeUndefined();
    await core.models();
  });

  it('lists the models it finds, each with its family and what loading it costs', async () => {
    const { core, gemma, qwen, old, bare } = await setup();
    const models = await core.models();
    const byPath = new Map(models.map((model) => [model.path, model]));
    expect(byPath.get(gemma)).toMatchObject({
      name: 'gemma-4-test',
      family: 'gemma',
      supported: true,
      announcement: { kind: 'engine-load', gpuBytes: 24 * GiB, verdict: 'fits', secondsEstimated: true },
    });
    expect(byPath.get(gemma)!.kvBytesPerToken).toBeGreaterThan(0);
    expect(byPath.get(qwen)).toMatchObject({ family: 'qwen', supported: true });
    expect(byPath.get(old)).toMatchObject({ family: null, supported: false, problem: 'unsupported-family' });
    expect(byPath.get(bare)).toMatchObject({ family: null, supported: false, problem: 'no-chat-template' });
  });

  it('a file it cannot read is listed as such, not dropped in silence', async () => {
    const { core, dir } = await setup();
    const broken = join(dir, 'models', 'broken.gguf');
    await writeFile(broken, 'not a gguf');
    const model = (await core.models()).find((candidate) => candidate.path === broken);
    expect(model).toMatchObject({ supported: false, problem: 'unreadable', announcement: null });
  });

  it('loads the model it is asked to, and a turn then runs on it, in its family', async () => {
    const { core, gemma } = await setup();
    expect(await core.loadModel(gemma)).toMatchObject({
      mode: 'managed',
      status: 'ready',
      model: { path: gemma, name: 'gemma-4-test', family: 'gemma' },
    });
    const engine = await core.engine();
    expect(engine?.family.id).toBe('gemma');
    expect((await engine!.client.props()).modelPath).toBe(gemma);
  });

  it('refuses to load a file that is not among the models it found', async () => {
    const { core, dir } = await setup();
    const elsewhere = join(dir, 'elsewhere.gguf');
    await writeFakeGguf(elsewhere);
    await expect(core.loadModel(elsewhere)).rejects.toThrow(/not among the models/);
    expect((await core.engineState()).status).toBe('stopped');
  });

  it('refuses a model the built-in engine cannot speak, before launching anything', async () => {
    const launched: string[] = [];
    const { core, old, bare } = await setup({
      spawn: (command) => {
        launched.push(command);
        throw new Error('nothing should be launched');
      },
    });
    await expect(core.loadModel(old)).rejects.toBeInstanceOf(UnsupportedFamilyError);
    await expect(core.loadModel(bare)).rejects.toMatchObject({ code: 'no-chat-template' });
    expect(launched).toEqual([]);
  });
});

describe('createCore — a server that already runs', () => {
  it('joins the server BONAPARTE_LLAMA_URL names, and speaks its family', async () => {
    const remote = await startFakeLlamaServer({ modelPath: 'D:\\remote\\qwen.gguf', chatTemplate: FAKE_QWEN_TEMPLATE });
    servers.push(remote);
    const { core } = await setup({ env: { BONAPARTE_LLAMA_URL: remote.url } });
    expect((await core.engineState()).mode).toBe('remote');
    const engine = await core.engine();
    expect(engine?.family.id).toBe('qwen');
    expect(await engine!.client.health()).toBe(true);
  });

  it('a server whose template it does not know: refused, with the family error', async () => {
    const remote = await startFakeLlamaServer({ chatTemplate: '### {{ m }}' });
    servers.push(remote);
    const { core } = await setup({ env: { BONAPARTE_LLAMA_URL: remote.url } });
    await expect(core.engine()).rejects.toBeInstanceOf(UnsupportedFamilyError);
  });
});

describe('createCore — the memory a load is announced against', () => {
  const MiB = 1024 ** 2;
  const DEVICES = 'Available devices:\n  Vulkan0: AMD Radeon(TM) 8060S Graphics (79992 MiB, 75992 MiB free)\n';

  /** Programs that print what the test says: llama.cpp lists its devices, PowerShell reads the registry. */
  function machine(devices: string, registry: string) {
    const launched: string[][] = [];
    const spawn: SpawnFn = (command, args) => {
      launched.push([command, ...args]);
      const stdout = new PassThrough();
      const child = Object.assign(new EventEmitter(), { stdout, stderr: new PassThrough(), kill: () => true });
      const text = args.includes('--list-devices') ? devices : command === 'powershell' ? registry : 'version: 9999 (fake)\n';
      setImmediate(() => {
        stdout.end(text);
        child.emit('exit', 0);
        child.emit('close', 0);
      });
      return child as unknown as SpawnedProcess;
    };
    return { spawn, launched };
  }

  it('is what llama.cpp can use — on a unified-memory machine, more than the registry says', async () => {
    const { spawn, launched } = machine(DEVICES, String(8 * GiB));
    const { core, gemma } = await setup({
      llamaCommand: undefined,
      gpuMemory: undefined,
      env: { BONAPARTE_LLAMA_BIN: 'llama' },
      spawn,
    });
    const model = (await core.models()).find((candidate) => candidate.path === gemma);
    expect(model?.announcement?.gpuBytes).toBe(79992 * MiB);
    // The unified CLI lists its devices under `serve`.
    expect(launched).toContainEqual(['llama', 'serve', '--list-devices']);
  });

  it('is the registry when llama.cpp lists no device', async () => {
    const { spawn } = machine('Available devices:\n', String(8 * GiB));
    const { core, gemma } = await setup({ llamaCommand: undefined, gpuMemory: undefined, env: { BONAPARTE_LLAMA_BIN: 'llama-server' }, spawn });
    const model = (await core.models()).find((candidate) => candidate.path === gemma);
    // Elsewhere than Windows, there is no registry: unknown, never zero.
    expect(model?.announcement?.gpuBytes).toBe(process.platform === 'win32' ? 8 * GiB : null);
  });
});
