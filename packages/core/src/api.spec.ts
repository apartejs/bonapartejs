/**
 * The core owns the engine. Starting it loads nothing; it lists the models
 * it finds, each with what loading it would cost; it loads one only when
 * asked, and a turn then runs on that engine, in the model's family.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCore, type Core, type CoreDeps } from './api.js';
import { UnsupportedFamilyError } from './families/index.js';
import { spawnHidden, type SpawnedProcess, type SpawnFn } from './process/spawn.js';
import { FAKE_QWEN_TEMPLATE, startFakeLlamaServer, type FakeLlamaServer } from './testing/fake-llama-server.js';
import { startFakeLlamaReleases, type FakeLlamaReleases } from './testing/fake-llama-releases.js';
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
    // A test never asks GitHub: the ones that need releases start their own.
    llamaReleases: null,
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

  it('switching models saves first the memory of the conversation the engine holds', async () => {
    const { core, dir, gemma, qwen } = await setup();
    await core.loadModel(gemma);
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: gemma, mode: 'repetition' });
    await core.conversations.turn('c1', { text: 'Bonjour' }, () => undefined);
    await core.loadModel(qwen);
    await expect(readFile(join(dir, 'data', 'kv-slots', 'c1_main.manifest.json'), 'utf8')).resolves.toContain('c1_main');
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

describe('createCore — the llama.cpp it runs', () => {
  let releases: FakeLlamaReleases[] = [];
  afterEach(async () => {
    await Promise.all(releases.map((one) => one.close()));
    releases = [];
  });

  async function published(): Promise<FakeLlamaReleases> {
    const one = await startFakeLlamaReleases({ build: 'b12383' });
    releases.push(one);
    return one;
  }

  it('says which llama.cpp it would run, and that a newer build is published — downloading nothing', async () => {
    const github = await published();
    const { core } = await setup({ llamaReleases: github.url });
    // The fake binary says `version: 9999 (fake)`.
    expect(await core.llamaCpp({ checkLatest: true })).toEqual({
      current: { source: 'path', build: 'b9999' },
      latest: { build: 'b12383', bytes: github.bytes },
      check: 'done',
      updateAvailable: true,
      installing: null,
    });
    expect(github.downloads).toBe(0);
  });

  it('asks GitHub only when the window asks it to', async () => {
    const github = await published();
    const { core } = await setup({ llamaReleases: github.url });
    expect(await core.llamaCpp()).toMatchObject({ latest: null, check: 'not-asked', updateAvailable: false });
  });

  it('says the check failed when GitHub cannot be reached — never « up to date »', async () => {
    const { core } = await setup({ llamaReleases: 'http://127.0.0.1:9/releases' });
    expect(await core.llamaCpp({ checkLatest: true })).toMatchObject({ latest: null, check: 'failed', updateAvailable: false });
  });

  it('downloads the newer build when asked, and keeps it as its own', async () => {
    const github = await published();
    const { core } = await setup({ llamaReleases: github.url });
    await core.llamaCpp({ checkLatest: true });
    expect(await core.installLlamaCpp()).toMatchObject({
      current: { source: 'managed', build: 'b12383' },
      updateAvailable: false,
      installing: null,
    });
    expect(github.downloads).toBe(1);
  });

  it('a load runs the build bonaparte installed, before the one on the PATH', async () => {
    const github = await published();
    const launched: string[] = [];
    const { core, gemma, dir } = await setup({
      llamaReleases: github.url,
      llamaCommand: undefined,
      spawn: (command, args, options) => {
        // The package is unpacked for real.
        if (/[\\/]?tar(\.exe)?$/i.test(command)) return spawnHidden(command, args, { stdio: options.stdio });
        launched.push(command);
        if (args.includes('--version')) throw new Error('no llama.cpp on this PATH');
        throw new Error('stop here: the test only looks at what was launched');
      },
    });
    await core.installLlamaCpp();
    await expect(core.loadModel(gemma)).rejects.toThrow();
    const server = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    expect(launched.at(-1)).toBe(join(dir, 'data', 'llama.cpp', 'b12383', server));
  });

  it('keeps the llama.cpp the person configured: no download is offered over it', async () => {
    const github = await published();
    const { core } = await setup({ llamaReleases: github.url, env: { BONAPARTE_LLAMA_BIN: 'C:\tools\llama-server.exe' } });
    expect(await core.llamaCpp({ checkLatest: true })).toMatchObject({
      current: { source: 'configured' },
      updateAvailable: false,
    });
  });
});


describe('createCore — what the review of phase 2 found', () => {
  let releases: FakeLlamaReleases[] = [];
  afterEach(async () => {
    await Promise.all(releases.map((one) => one.close()));
    releases = [];
  });

  it('a loaded model stays loaded however long nothing happens: its unloading comes with the announced reload (7.4)', async () => {
    const { core, gemma } = await setup();
    await core.loadModel(gemma);
    // The quiet starts when the last turn ends.
    const release = core.hold();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      release();
      vi.advanceTimersByTime(60 * 60_000);
    } finally {
      vi.useRealTimers();
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await core.engineState()).status).toBe('ready');
    expect(await core.engine()).toBeDefined();
  });

  it('refuses to replace llama.cpp under a model that loads or runs', async () => {
    const github = await startFakeLlamaReleases();
    releases.push(github);
    const { core, gemma } = await setup({ llamaReleases: github.url });
    await core.loadModel(gemma);
    await expect(core.installLlamaCpp()).rejects.toThrow(/model is loaded/);
    expect(github.downloads).toBe(0);
  });
});

describe('createCore — the modes and the previews of the window', () => {
  it('a conversation runs in the mode set for it; Impro does not survive a restart without a new confirmation', async () => {
    const { core, dir } = await setup();
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: '', mode: 'repetition' });
    expect(await core.modeOf('c1')).toEqual({ mode: 'repetition', reconfirm: false });
    await core.setMode('c1', 'impro');
    expect(await core.modeOf('c1')).toEqual({ mode: 'impro', reconfirm: false });

    const again = createCore({ dataDir: join(dir, 'data'), env: {}, logger: () => undefined });
    cores.push(again);
    expect(await again.modeOf('c1')).toEqual({ mode: 'plume', reconfirm: true });
    await again.setMode('c1', 'impro');
    expect(await again.modeOf('c1')).toEqual({ mode: 'impro', reconfirm: false });
  });

  it("a test run's home folder is where the tools work without a project", async () => {
    const home = await mkdtemp(join(tmpdir(), 'bp-core-home-'));
    dirs.push(home);
    await writeFile(join(home, 'notes.txt'), 'old line\n');
    const { core } = await setup({ home });
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: '', mode: 'repetition' });
    const preview = await core.previewCall('c1', { name: 'edit_file', input: { path: 'notes.txt', old_string: 'old line', new_string: 'new line' } });
    expect(preview).toMatchObject({ kind: 'diff', path: 'notes.txt', before: 'old line\n', after: 'new line\n' });
  });

  it("deleting a conversation takes the originals its turns kept with it: copies of the person's files never outlive it", async () => {
    const { core } = await setup();
    const dir = await mkdtemp(join(tmpdir(), 'bp-core-forget-'));
    dirs.push(dir);
    await writeFile(join(dir, 'notes.txt'), 'secret\n');
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: '', mode: 'repetition' });
    await core.checkpoints.before('c1', 'm1', join(dir, 'notes.txt'), 'notes.txt');
    expect(await core.checkpoints.changes('c1', 'm1')).toBeDefined();
    await core.removeConversation('c1');
    expect(await core.checkpoints.changes('c1', 'm1')).toBeUndefined();
    expect(await core.conversationStore.get('c1')).toBeNull();
  });

  it("without a project, and outside a test run, the tools work in the person's home folder", async () => {
    const { core } = await setup();
    const write = core.tools.get('write_file')!.def;
    const inHome = core.permissions.evaluate({ tool: write, input: { path: join(homedir(), 'bp-never-written.txt') }, mode: 'plume' });
    expect(inHome).toEqual({ verdict: 'allow' });
  });

  it('previews a write: the text before and after, and their diff — nothing is written', async () => {
    const { core } = await setup();
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: '', mode: 'repetition' });
    const preview = await core.previewCall('c1', { name: 'write_file', input: { path: 'bonaparte-preview-never-written.txt', content: 'one\n' } });
    expect(preview).toMatchObject({ kind: 'diff', before: null, after: 'one\n' });
    expect(preview?.kind === 'diff' ? preview.diff : '').toContain('+one');
    expect(await core.previewCall('c1', { name: 'read_file', input: { path: 'x' } })).toBeNull();
  });
});
