/**
 * The core owns the engine. Starting it loads nothing; it lists the models
 * it finds, each with what loading it would cost; it loads one only when
 * asked, and a turn then runs on that engine, in the model's family.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCore, type Core, type CoreDeps } from './api.js';
import { openJournal } from './journal/journal.js';
import { UnsupportedFamilyError } from './families/index.js';
import { spawnHidden, type SpawnedProcess, type SpawnFn } from './process/spawn.js';
import { FAKE_QWEN_TEMPLATE, startFakeLlamaServer, type FakeLlamaServer } from './testing/fake-llama-server.js';
import { startFakeLlamaReleases, type FakeLlamaReleases } from './testing/fake-llama-releases.js';
import { writeFakeGguf } from './testing/fake-gguf.js';
import { startFakeModelHub, type FakeModelHub } from './testing/fake-model-hub.js';
import { DigestMismatchError } from './models/download.js';
import type { CatalogueEntry } from './models/catalogue.js';
import { createHash } from 'node:crypto';

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
    // Nor Hugging Face: the ones that download start their own hub.
    modelHub: null,
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

  it('looks in the folders the person added, and says which model is the default', async () => {
    const { core, dir, gemma } = await setup();
    const added = join(dir, 'added');
    await mkdir(added, { recursive: true });
    const extra = join(added, 'gemma-4-extra.gguf');
    await writeFakeGguf(extra, {});
    expect((await core.models()).map((model) => model.path)).not.toContain(extra);
    await core.settings.set('modelFolders', [added]);
    await core.settings.set('defaultModel', gemma);
    const models = await core.models();
    expect(models.map((model) => model.path)).toContain(extra);
    expect(models.find((model) => model.path === gemma)).toMatchObject({ isDefault: true, lastLoadedAt: null });
    expect(models.find((model) => model.path === extra)).toMatchObject({ isDefault: false });
  });

  it('a folder added, or found on the disk, joins the folders searched — once', async () => {
    const { core, dir } = await setup();
    const found = join(dir, 'disk', 'deep', 'models');
    await mkdir(found, { recursive: true });
    await writeFakeGguf(join(found, 'gemma-4-disk.gguf'), {});
    expect(await core.addModelFolder(join(dir, 'added'))).toEqual([join(dir, 'added')]);
    expect(await core.addModelFolder(join(dir, 'added'))).toEqual([join(dir, 'added')]);
    const scanning = await setup({ diskRoots: async () => [join(dir, 'disk')] });
    scanning.core.diskScan.start();
    await scanning.core.diskScan.whenDone();
    expect(await scanning.core.settings.get('modelFolders')).toEqual([found]);
    expect((await scanning.core.models()).map((model) => model.name)).toContain('gemma-4-disk');
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

  it('« Moteur et mémoire »: the engine since when, the memories under the budget, unloaded and restarted', async () => {
    const { core, gemma } = await setup();
    expect((await core.memory()).engine).toMatchObject({ running: false, since: null });
    await core.loadModel(gemma);
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: gemma, mode: 'repetition' });
    await core.conversations.turn('c1', { text: 'Bonjour' }, () => undefined);
    const running = await core.memory();
    expect(running.engine).toMatchObject({ running: true, model: { name: 'gemma-4-test' }, cacheType: 'f16', slots: 1 });
    expect(running.engine.since).not.toBeNull();
    expect(running.rows).toEqual([expect.objectContaining({ id: 'c1', state: 'engine' })]);
    expect(running.budgetBytes).toBeGreaterThan(0);

    await core.settings.set('kvBudgetBytes', 3 * 1024 ** 3);
    expect((await core.memory()).budgetBytes).toBe(3 * 1024 ** 3);

    await core.unloadModel();
    expect(await core.engineState()).toMatchObject({ status: 'stopped' });
    const unloaded = await core.memory();
    expect(unloaded.engine.running).toBe(false);
    // Unloading kept the memory on disk.
    await core.loadModel(gemma);
    expect((await core.memory()).rows).toEqual([expect.objectContaining({ id: 'c1', state: 'saved' })]);
    const before = (await core.memory()).engine.since;
    await core.restartEngine();
    const after = await core.memory();
    expect(after.engine.running).toBe(true);
    expect(after.engine.since).not.toBe(before);
  }, 20_000);

  it('« Décharger » and « Redémarrer » are refused while a reply holds the engine, and the page is told it runs', async () => {
    const { core, gemma } = await setup();
    await core.loadModel(gemma);
    const release = core.hold();
    expect((await core.memory()).engine.busy).toBe(true);
    await expect(core.unloadModel()).rejects.toThrow(/reply is running/);
    await expect(core.restartEngine()).rejects.toThrow(/reply is running/);
    expect(await core.engineState()).toMatchObject({ status: 'ready' });
    release();
    expect((await core.memory()).engine.busy).toBe(false);
    await core.unloadModel();
    expect(await core.engineState()).toMatchObject({ status: 'stopped' });
  });

  it('with « En parallèle » kept, what a load costs counts the second slot (review of phase 8)', async () => {
    const { core } = await setup();
    const vram = async () => (await core.models()).find((model) => model.path.endsWith('gemma-4-test.gguf'))!.announcement!.vramBytes;
    const one = await vram();
    await core.applyEngineSettings({ subagents: 'parallel' }, { restart: false });
    expect(await vram()).toBeGreaterThan(one);
  });

  it('« Relire et continuer » holds the engine while it reads: neither unloaded nor restarted under it (review of phase 8)', async () => {
    const { core, gemma } = await setup();
    await core.loadModel(gemma);
    let busy: boolean | null = null;
    vi.spyOn(core.conversations, 'readAgain').mockImplementation(async () => {
      busy = (await core.memory()).engine.busy;
    });
    await core.readAgain('c1');
    expect(busy).toBe(true);
    expect((await core.memory()).engine.busy).toBe(false);
  });

  it('switching models saves first the memory of the conversation the engine holds', async () => {
    const { core, dir, gemma, qwen } = await setup();
    await core.loadModel(gemma);
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: gemma, mode: 'repetition' });
    await core.conversations.turn('c1', { text: 'Bonjour' }, () => undefined);
    await core.loadModel(qwen);
    await expect(readFile(join(dir, 'data', 'kv-slots', 'c1_main.manifest.json'), 'utf8')).resolves.toContain('c1_main');
  });

  it('says what changing model costs before anything is paid: the reload, the re-reading, the video memory now and after', async () => {
    const { core, gemma, qwen } = await setup();
    await core.loadModel(gemma);
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: gemma, mode: 'repetition' });
    await core.conversations.turn('c1', { text: 'Bonjour' }, () => undefined);
    const listed = await core.models();
    const target = listed.find((model) => model.path === qwen)!.announcement!;
    const current = listed.find((model) => model.path === gemma)!.announcement!;

    const cost = await core.modelSwitch(qwen, 'c1');
    expect(cost).toMatchObject({
      to: { path: qwen, name: 'qwen-test' },
      from: { path: gemma, name: 'gemma-4-test' },
      announcement: { kind: 'model-switch', reloadSeconds: target.seconds, vramBytes: target.vramBytes, vramBytesNow: current.vramBytes },
    });
    expect(cost.announcement.rereadTokens).toBeGreaterThan(0);
    // Nothing was loaded to say it.
    expect((await core.engineState()).model?.path).toBe(gemma);
    // Without a conversation, or with the engine unloaded: the reload alone, and no memory taken now.
    await core.unloadModel();
    expect(await core.modelSwitch(qwen)).toMatchObject({ from: null, announcement: { rereadTokens: 0, vramBytesNow: 0 } });
  }, 20_000);

  it('changing model is refused under a reply; done, the conversation goes on in the new model at its next message', async () => {
    const { core, gemma, qwen } = await setup();
    await core.loadModel(gemma);
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: gemma, mode: 'repetition' });
    await core.conversations.turn('c1', { text: 'Bonjour' }, () => undefined);
    const release = core.hold();
    await expect(core.switchModel(qwen, { conversationId: 'c1' })).rejects.toThrow(/reply is running/);
    release();
    expect(await core.switchModel(qwen, { conversationId: 'c1' })).toMatchObject({ conversationId: 'c1', state: { model: { path: qwen, family: 'qwen' } } });
    await core.conversations.turn('c1', { text: 'Et en Qwen ?' }, () => undefined);
    const meta = (await core.conversationStore.get('c1'))!;
    const entries = (await openJournal(core.conversationStore.dir, 'c1', meta.branchId)).entries();
    expect(entries.find((entry) => entry.kind === 'engine')).toMatchObject({ modelId: qwen, family: 'qwen' });
  }, 20_000);

  it('« Brancher sur ce modèle »: a new conversation on the new model, the original kept on its own', async () => {
    const { core, gemma, qwen } = await setup();
    await core.loadModel(gemma);
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: gemma, mode: 'repetition' });
    await core.conversations.turn('c1', { text: 'Bonjour' }, () => undefined);
    const { conversationId } = await core.switchModel(qwen, { conversationId: 'c1', as: 'copy' });
    expect(conversationId).not.toBe('c1');
    const copied = (await openJournal(core.conversationStore.dir, conversationId!)).entries();
    expect(copied.at(-1)).toMatchObject({ kind: 'engine', modelId: qwen, family: 'qwen' });
    const original = (await openJournal(core.conversationStore.dir, 'c1')).entries();
    expect(original.some((entry) => entry.kind === 'engine')).toBe(false);
    expect((await core.engineState()).model?.path).toBe(qwen);
  }, 20_000);

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

describe('createCore — the web search (task 10.4)', () => {
  const searcher = {
    id: 'searcher',
    name: { en: 'Searcher', fr: 'Chercheur' },
    version: '1.0.0',
    description: { en: 'Searches.', fr: 'Cherche.' },
    effects: [{ effect: 'network' as const, what: { en: 'the web', fr: 'le web' } }],
  };

  it('a plugin that declares network searches through the hidden page the app gives — the public engine by default', async () => {
    const asked: string[] = [];
    const { core } = await setup({
      webSearch: async (query) => {
        asked.push(query);
        return [{ title: 'KV', href: 'https://example.com/kv', snippet: 'kept' }];
      },
    });
    let search: ((query: string, max: number) => Promise<unknown>) | undefined;
    core.plugins.add(searcher, { builtin: true });
    await core.plugins.activate('searcher', { activate: (ctx) => void (search = ctx.search) });
    expect(await search!('kv cache', 3)).toEqual({ provider: 'embedded', results: [{ title: 'KV', url: 'https://example.com/kv', snippet: 'kept' }] });
    expect(asked).toEqual(['kv cache']);
  });

  it('an online provider chosen in the settings: its key comes from the vault, never from a setting', async () => {
    const held = new Map<string, string>([['search-brave', 'brave-key']]);
    const sent: Record<string, string>[] = [];
    const { core } = await setup({
      secrets: { get: async (name) => held.get(name), set: async () => undefined, delete: async () => undefined, has: async (name) => held.has(name) },
      fetch: async (_input, init) => {
        sent.push((init?.headers ?? {}) as Record<string, string>);
        return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
      },
    });
    await core.settings.set('webSearchProvider', 'brave');
    let search: ((query: string, max: number) => Promise<unknown>) | undefined;
    core.plugins.add(searcher, { builtin: true });
    await core.plugins.activate('searcher', { activate: (ctx) => void (search = ctx.search) });
    expect(await search!('kv cache', 3)).toEqual({ provider: 'brave', results: [] });
    expect(sent[0]?.['X-Subscription-Token']).toBe('brave-key');
  });
});

describe('createCore — bonaparte doctor (task 9.6)', () => {
  it('says what the machine has for the built-in engine — llama.cpp found as a load would find it, the card — running nothing else', async () => {
    const { core, dir } = await setup();
    const report = await core.doctor();
    expect(report.checks.map((check) => [check.id, check.status])).toEqual([
      ['node', 'ok'],
      ['llama', 'ok'],
      ['slots', 'ok'],
      ['gpu', 'ok'],
    ]);
    expect(report.checks[1]).toMatchObject({ source: 'path', build: 'b9999' });
    expect(report.checks[2]).toMatchObject({ dir: join(dir, 'data', 'kv-slots') });
    expect(report.checks[3]).toMatchObject({ bytes: 24 * GiB });
    expect(await core.engineState()).toMatchObject({ status: 'stopped' });
  });

  it('a llama.cpp configured that does not answer fails — no other one is looked for', async () => {
    const { core } = await setup({ env: { BONAPARTE_LLAMA_BIN: join(tmpdir(), 'bp-nowhere', 'llama-server.exe') } });
    const report = await core.doctor();
    expect(report.checks[1]).toMatchObject({ status: 'fail', source: 'configured', build: null });
    expect(report.ok).toBe(false);
  });
});

describe('createCore — the models it recommends (task 9.5)', () => {
  let hubs: FakeModelHub[] = [];
  afterEach(async () => {
    await Promise.all(hubs.map((one) => one.close()));
    hubs = [];
  });

  /** A catalogue of one small model, and the hub that serves it — or serves other bytes than announced. */
  async function published(options: { tampered?: boolean; paceMs?: number } = {}) {
    const work = await mkdtemp(join(tmpdir(), 'bp-hub-'));
    dirs.push(work);
    const file = join(work, 'small.gguf');
    await writeFakeGguf(file, { paddingBytes: 8192 });
    const body = await readFile(file);
    const entry: CatalogueEntry = {
      id: 'gemma-small',
      family: 'gemma',
      name: 'Gemma small',
      repo: 'google/gemma-small-gguf',
      file: 'gemma-small.gguf',
      bytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
      context: 8192,
      fromGiB: 0,
    };
    const served = options.tampered ? Buffer.concat([body, Buffer.from('!')]) : body;
    const hub = await startFakeModelHub({
      files: { 'google/gemma-small-gguf/gemma-small.gguf': served },
      ...(options.paceMs ? { paceMs: options.paceMs } : {}),
    });
    hubs.push(hub);
    return { entry, hub };
  }

  it('says the models recommended for the machine, with their size — downloading nothing', async () => {
    const { entry, hub } = await published();
    const { core } = await setup({ modelHub: hub.url, modelCatalogue: [entry] });
    expect(await core.recommendedModels()).toEqual([
      { id: 'gemma-small', family: 'gemma', name: 'Gemma small', file: 'gemma-small.gguf', bytes: entry.bytes, context: 8192, path: null, downloading: null },
    ]);
    expect(hub.downloads).toBe(0);
  });

  it('recommends by the memory of the card: the catalogue of the product on a 24 GiB card', async () => {
    const { core } = await setup();
    expect((await core.recommendedModels()).map((one) => one.id)).toEqual(['gemma-4-26b-a4b', 'qwen3-30b-a3b']);
  });

  it('downloads one when asked, keeps it in its own folder, and lists it among the models found', async () => {
    const { entry, hub } = await published();
    const { core, dir } = await setup({ modelHub: hub.url, modelCatalogue: [entry] });
    const kept = join(dir, 'data', 'models', 'gemma-small.gguf');
    expect(await core.downloadModel('gemma-small')).toMatchObject({ id: 'gemma-small', path: kept, downloading: null });
    expect(hub.downloads).toBe(1);
    expect((await core.models()).find((model) => model.path === kept)).toMatchObject({ source: 'bonaparte', supported: true });
    expect((await core.recommendedModels())[0]).toMatchObject({ path: kept });
  });

  it('says how far a download is while it runs', async () => {
    const { entry, hub } = await published({ paceMs: 150 });
    const { core } = await setup({ modelHub: hub.url, modelCatalogue: [entry] });
    const running = core.downloadModel('gemma-small');
    await vi.waitFor(async () => expect((await core.recommendedModels())[0]!.downloading).toMatchObject({ total: entry.bytes }));
    await running;
    expect((await core.recommendedModels())[0]!.downloading).toBeNull();
  });

  it('deletes a file that is not the one announced — never listed, never loaded', async () => {
    const { entry, hub } = await published({ tampered: true });
    const { core, dir } = await setup({ modelHub: hub.url, modelCatalogue: [entry] });
    await expect(core.downloadModel('gemma-small')).rejects.toBeInstanceOf(DigestMismatchError);
    expect(await readdir(join(dir, 'data', 'models')).catch(() => [])).toEqual([]);
    expect((await core.recommendedModels())[0]).toMatchObject({ path: null, downloading: null });
  });

  it('downloads only a model of its catalogue, and never asks a hub in a test that gives none', async () => {
    const { entry } = await published();
    const { core } = await setup({ modelCatalogue: [entry] });
    await expect(core.downloadModel('anything-else')).rejects.toThrow(/not one bonaparte recommends/);
    await expect(core.downloadModel('gemma-small')).rejects.toThrow(/no hub/);
  });
});


describe('createCore — what the review of phase 2 found', () => {
  let releases: FakeLlamaReleases[] = [];
  afterEach(async () => {
    await Promise.all(releases.map((one) => one.close()));
    releases = [];
  });

  it('after the minutes of its setting without work, the model is unloaded — the memory kept, the window told, the model to load again said (7.4)', async () => {
    let told = 0;
    const { core, dir, gemma } = await setup({ engineChanged: () => (told += 1) });
    await core.loadModel(gemma);
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: gemma, mode: 'repetition' });
    await core.conversations.turn('c1', { text: 'Bonjour' }, () => undefined);
    await core.settings.set('idleUnloadMinutes', 5);
    // The quiet starts when the last turn ends.
    const release = core.hold();
    told = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      release();
      vi.advanceTimersByTime(4 * 60_000);
      expect((await core.engineState()).status).toBe('ready');
      vi.advanceTimersByTime(60_000);
    } finally {
      vi.useRealTimers();
    }
    // The engine stops as the process of the test exits: slower on a loaded machine.
    await expect.poll(async () => (await core.engineState()).status, { timeout: 15_000 }).toBe('stopped');
    expect(await core.engine()).toBeUndefined();
    expect(await core.engineState()).toMatchObject({ resume: { path: gemma, name: 'gemma-4-test', idleMinutes: 5 } });
    expect((await core.engineState()).resume?.unloadedAt).toBeTruthy();
    expect(told).toBeGreaterThan(0);
    // The memory of the conversation was saved before the engine went.
    await expect(readFile(join(dir, 'data', 'kv-slots', 'c1_main.manifest.json'), 'utf8')).resolves.toContain('c1_main');
  }, 20_000);

  it('a setting that restarts the engine says first what it costs: the reload, the memories it makes to read again, a reply that runs', async () => {
    const { core, gemma } = await setup();
    await core.loadModel(gemma);
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: gemma, mode: 'repetition' });
    await core.conversations.turn('c1', { text: 'Bonjour' }, () => undefined);
    await core.conversations.flush();
    expect(await core.engineSettings()).toMatchObject({ nCtx: 8192, cacheType: 'f16' });

    const cache = await core.restartCost({ cacheType: 'q8_0' });
    expect(cache).toMatchObject({ kind: 'restart', setting: 'cacheType', memoriesLost: 1, replyRunning: false, loaded: true });
    expect(cache.reloadSeconds).toBeGreaterThan(0);
    expect(await core.restartCost({ nCtx: 16_384 })).toMatchObject({ setting: 'nCtx', memoriesLost: 0 });
    const release = core.hold();
    expect(await core.restartCost({ nCtx: 16_384 })).toMatchObject({ replyRunning: true });
    release();
    // Nothing kept by asking.
    expect(await core.engineSettings()).toMatchObject({ nCtx: 8192, cacheType: 'f16' });
  }, 20_000);

  it('kept with a restart, the engine relaunches with them — after the reply that runs; kept for later, at the next load', async () => {
    const { core, gemma } = await setup();
    await core.loadModel(gemma);
    await core.applyEngineSettings({ nCtx: 4096 }, { restart: true });
    expect((await core.engineState()).model?.nCtx).toBe(4096);

    await core.applyEngineSettings({ nCtx: 2048 }, { restart: false });
    expect((await core.engineSettings()).nCtx).toBe(2048);
    expect((await core.engineState()).model?.nCtx).toBe(4096);
    // « Moteur et mémoire » says what runs, not what is kept for later.
    expect((await core.memory()).engine).toMatchObject({ nCtx: 4096, cacheType: 'f16' });

    const release = core.hold();
    await core.applyEngineSettings({ nCtx: 6144 }, { restart: true });
    expect((await core.engineState()).model?.nCtx).toBe(4096);
    release();
    await expect.poll(async () => (await core.engineState()).model?.nCtx, { timeout: 15_000 }).toBe(6144);

    await core.unloadModel();
    await core.applyEngineSettings({ nCtx: 2048 }, { restart: false });
    await core.loadModel(gemma);
    expect((await core.engineState()).model?.nCtx).toBe(2048);
  }, 40_000);

  it('sub-agents in parallel (task 8.3): said first — one slot more, its video memory, a restart —, kept only on a choice; then two slots, each with the context asked', async () => {
    const { core, gemma } = await setup();
    await core.loadModel(gemma);
    expect(await core.engineSettings()).toMatchObject({ subagents: 'sequential' });
    const cost = await core.restartCost({ subagents: 'parallel' });
    expect(cost).toMatchObject({ kind: 'restart', setting: 'subagents', loaded: true, parallel: { slots: 2 } });
    expect(cost.parallel!.vramBytesEach).toBeGreaterThan(0);
    // Nothing restarts, nothing is kept, by asking.
    expect((await core.memory()).engine.slots).toBe(1);
    expect(await core.engineSettings()).toMatchObject({ subagents: 'sequential' });

    await core.applyEngineSettings({ subagents: 'parallel' }, { restart: true });
    await expect.poll(async () => (await core.memory()).engine.slots, { timeout: 15_000 }).toBe(2);
    expect(await core.engineSettings()).toMatchObject({ subagents: 'parallel' });
    // Each slot keeps the context asked: -c is shared between them.
    expect((await core.engineState()).model?.nCtx).toBe(8192);
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: gemma, mode: 'repetition' });
    await core.conversations.turn('c1', { text: 'Bonjour' }, () => undefined);
    expect(core.conversations.slotCount).toBe(2);
    // Back to one after the other: no slot more to announce.
    expect((await core.restartCost({ subagents: 'sequential' })).parallel).toBeUndefined();
  }, 40_000);

  it('an engine being unloaded serves no new turn: it would be cut under it (review of phase 7)', async () => {
    const { core, gemma } = await setup();
    await core.loadModel(gemma);
    const unloading = core.unloadModel();
    expect(await core.engine()).toBeUndefined();
    expect((await core.engineState()).status).not.toBe('ready');
    await unloading;
  }, 20_000);

  it('« Jamais » chosen while a delay runs: the model is not unloaded (review of phase 7)', async () => {
    const { core, gemma } = await setup();
    await core.loadModel(gemma);
    const release = core.hold();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      // The quiet starts: fifteen minutes armed. Then the person chooses « Jamais ».
      release();
      await core.settings.set('idleUnloadMinutes', 0);
      vi.advanceTimersByTime(60 * 60_000);
    } finally {
      vi.useRealTimers();
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await core.engineState()).status).toBe('ready');
  }, 20_000);

  it('settings kept for later are taken by the next load of another model, as its announcement said (review of phase 7)', async () => {
    const { core, gemma, qwen } = await setup();
    await core.loadModel(gemma);
    await core.applyEngineSettings({ nCtx: 4096 }, { restart: false });
    await core.loadModel(qwen);
    expect((await core.engineState()).model?.nCtx).toBe(4096);
  }, 30_000);

  it('a compaction holds the engine: neither unloaded nor restarted under its summary (review of phase 7)', async () => {
    const { core, gemma } = await setup();
    await core.loadModel(gemma);
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: gemma, mode: 'repetition' });
    await core.conversations.turn('c1', { text: 'Bonjour' }, () => undefined);
    const compacting = core.compact('c1');
    await expect(core.unloadModel()).rejects.toThrow(/reply is running/);
    await compacting;
  }, 20_000);

  it('a window told the engine is ready can send at once: the model is known before it is told', async () => {
    const told: { core?: Core } = {};
    const asked: Promise<unknown>[] = [];
    const states: Promise<{ status: string }>[] = [];
    const { core, gemma } = await setup({
      engineChanged: () => {
        // What the window does when told: read the state, and a message may follow at once.
        if (!told.core) return;
        states.push(told.core.engineState());
        asked.push(told.core.engine());
      },
    });
    told.core = core;
    await core.loadModel(gemma);
    const seen = await Promise.all(states);
    const engines = await Promise.all(asked);
    const whenReady = seen.map((state, index) => (state.status === 'ready' ? engines[index] : 'not ready')).filter((one) => one !== 'not ready');
    expect(whenReady.length).toBeGreaterThan(0);
    expect(whenReady.every((engine) => engine !== undefined)).toBe(true);
  }, 20_000);

  it('« 0 » never unloads; unloaded by the person, the model to load again is said, without a delay', async () => {
    const { core, gemma } = await setup();
    await core.settings.set('idleUnloadMinutes', 0);
    await core.loadModel(gemma);
    const release = core.hold();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      release();
      vi.advanceTimersByTime(24 * 60 * 60_000);
    } finally {
      vi.useRealTimers();
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await core.engineState()).status).toBe('ready');
    await core.unloadModel();
    const state = await core.engineState();
    expect(state).toMatchObject({ status: 'stopped', resume: { path: gemma, name: 'gemma-4-test' } });
    expect(state.resume?.idleMinutes).toBeUndefined();
  }, 20_000);

  it('at launch nothing is loaded: the model a load would bring back is the default one, else the one loaded last', async () => {
    const { core, dir, gemma, qwen } = await setup();
    expect((await core.engineState()).resume).toBeUndefined();
    await core.loadModel(qwen);
    await core.stop();
    const again = createCore({
      dataDir: join(dir, 'data'),
      env: {},
      llamaCommand: [process.execPath, BIN],
      port: await freePort(),
      modelRoots: [{ dir: join(dir, 'models'), source: 'custom' }],
      gpuMemory: async () => 24 * GiB,
      llamaReleases: null,
      logger: () => undefined,
    });
    cores.push(again);
    expect(await again.engineState()).toMatchObject({ status: 'stopped', resume: { path: qwen, name: 'qwen-test' } });
    await again.settings.set('defaultModel', gemma);
    expect((await again.engineState()).resume?.path).toBe(gemma);
  }, 20_000);

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

  it("a conversation's document is the page's own — and, when it is missing, rebuilt from the journal", async () => {
    const { core } = await setup();
    const meta = await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: '', mode: 'repetition', title: 'Bonjour' });
    const journal = await openJournal(core.conversationStore.dir, 'c1', meta.branchId);
    await journal.append({ kind: 'user', text: 'Bonjour', messageId: 'u1', rendered: '' });
    await journal.append({ kind: 'assistant', raw: 'Bonjour Paul.', messageId: 'a1', rendered: '' });
    const rebuilt = (await core.conversationDocument('c1')) as { messages: { role: string; content: string }[] };
    expect(rebuilt.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'Bonjour'],
      ['assistant', 'Bonjour Paul.'],
    ]);
    const saved = { id: 'c1', title: 'Bonjour', messages: [{ id: 'u1', role: 'user', content: 'Bonjour (page)' }] };
    await core.conversationStore.saveDocument('c1', saved);
    expect(await core.conversationDocument('c1')).toEqual(saved);
    expect(await core.conversationDocument('nobody')).toBeNull();
  });

  it('a project is made from a folder: what the folder says, its name, its folders, its mode — nothing written in the folder', async () => {
    const { core } = await setup();
    const folder = await mkdtemp(join(tmpdir(), 'bp-core-project-'));
    dirs.push(folder);
    await writeFile(join(folder, 'AGENTS.md'), 'Use pnpm.\n');
    const facts = await core.projects.detect(folder);
    expect(facts).toMatchObject({ instructions: 'AGENTS.md', git: null });
    const project = await core.projects.create({ name: 'spanwise', roots: [folder], defaultMode: 'plume' });
    expect(project).toMatchObject({ name: 'spanwise', roots: [folder], defaultMode: 'plume' });
    expect(await core.projects.list()).toEqual([project]);
    expect(await readdir(folder)).toEqual(['AGENTS.md']);
  });

  it("a conversation of a project works in the project's folders, not in the home folder", async () => {
    const { core } = await setup();
    const folder = await mkdtemp(join(tmpdir(), 'bp-core-project-'));
    dirs.push(folder);
    await writeFile(join(folder, 'notes.txt'), 'old line\n');
    const project = await core.projects.create({ name: 'p', roots: [folder] });
    await core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: '', mode: 'repetition', projectId: project.id });
    const preview = await core.previewCall('c1', { name: 'edit_file', input: { path: 'notes.txt', old_string: 'old line', new_string: 'new line' } });
    expect(preview).toMatchObject({ kind: 'diff', before: 'old line\n', after: 'new line\n' });
  });

  it('« Rechercher » finds the files of a project before its first conversation exists — and none without a project', async () => {
    const { core } = await setup();
    const folder = await mkdtemp(join(tmpdir(), 'bp-core-project-'));
    dirs.push(folder);
    await writeFile(join(folder, 'format.ts'), 'export {};\n');
    const project = await core.projects.create({ name: 'p', roots: [folder] });
    expect((await core.search('form', { projectId: project.id })).files).toEqual([{ path: 'format.ts' }]);
    expect((await core.search('form', { projectId: 'gone' })).files).toEqual([]);
    expect((await core.search('form')).files).toEqual([]);
  });

  it('« Permissions »: a file added to « toujours demandé » asks even in Plume; the network asked or not', async () => {
    const { core, dir } = await setup();
    const folder = join(dir, 'project');
    await mkdir(folder, { recursive: true });
    const project = await core.projects.create({ name: 'p', roots: [folder] });
    const write = core.tools.get('write_file')!.def;
    const fetchPage = core.tools.get('web_fetch')!.def;
    const dockerfile = { tool: write, input: { path: join(folder, 'Dockerfile') }, mode: 'plume' as const, projectId: project.id };
    expect(core.permissions.evaluate(dockerfile)).toEqual({ verdict: 'allow' });
    await core.settings.set('alwaysAsk', ['Dockerfile']);
    expect(core.permissions.evaluate(dockerfile)).toEqual({ verdict: 'ask', why: 'armed-path' });

    // A project's own list asks in that project only.
    await core.settings.set('alwaysAsk', []);
    await core.projects.update(project.id, { alwaysAsk: ['Makefile'] });
    const makefile = { ...dockerfile, input: { path: join(folder, 'Makefile') } };
    expect(core.permissions.evaluate(makefile)).toEqual({ verdict: 'ask', why: 'armed-path' });

    const online = { tool: fetchPage, input: { url: 'https://example.com' }, projectId: project.id };
    expect(core.permissions.evaluate({ ...online, mode: 'impro' })).toMatchObject({ verdict: 'ask' });
    await core.settings.set('askBeforeNetwork', false);
    expect(core.permissions.evaluate({ ...online, mode: 'impro' })).toEqual({ verdict: 'allow' });
    for (const mode of ['lecture', 'repetition', 'plume'] as const) {
      expect(core.permissions.evaluate({ ...online, mode }).verdict).not.toBe('allow');
    }
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

describe('createCore — the providers (task 9.1)', () => {
  const vault = () => {
    const held = new Map<string, string>();
    return {
      held,
      get: async (name: string) => held.get(name),
      set: async (name: string, value: string) => void held.set(name, value),
      delete: async (name: string) => void held.delete(name),
      has: async (name: string) => held.has(name),
    };
  };

  it('a service added keeps its key in the vault given, never in a file; the window is told only that there is one', async () => {
    const secrets = vault();
    const { core, dir } = await setup({ secrets });
    const added = await core.providers.add({ kind: 'openai-compat', label: 'Ollama', url: 'http://localhost:11434/v1', server: 'ollama' }, 'sk-ollama');
    expect(await core.providers.list()).toEqual([
      expect.objectContaining({ id: 'builtin', hasKvMemory: true, hasKey: false }),
      expect.objectContaining({ id: added.id, label: 'Ollama', hasKvMemory: false, hasKey: true }),
    ]);
    expect(JSON.stringify(await core.providers.list())).not.toContain('sk-ollama');
    expect([...secrets.held.values()]).toEqual(['sk-ollama']);
    for (const name of await readdir(join(dir, 'data', 'config'))) {
      expect(await readFile(join(dir, 'data', 'config', name), 'utf8')).not.toContain('sk-ollama');
    }
    await core.providers.remove(added.id);
    expect(secrets.held.size).toBe(0);
  });

  it('a conversation on a service has no memory to show, whatever the built-in engine holds (task 9.3)', async () => {
    const { core, gemma } = await setup({ secrets: vault() });
    await core.loadModel(gemma);
    const service = await core.providers.add({ kind: 'openai-compat', label: 'Ollama', url: 'http://127.0.0.1:9/v1' });
    await core.conversationStore.ensure('c2', { kind: 'code', engineId: service.id, modelId: 'qwen3:8b', mode: 'repetition' });
    const meta = await core.conversationStore.get('c2');
    await (await openJournal(core.conversationStore.dir, 'c2', meta!.branchId)).append({ kind: 'user', text: 'Bonjour' });
    expect(await core.conversations.status('c2')).toMatchObject({ memory: null });
    expect((await core.memory()).rows.map((row) => row.id)).not.toContain('c2');
  }, 20_000);

  it('without a vault, a key is refused, never written; a service without one is added', async () => {
    const { core } = await setup();
    await expect(core.providers.add({ kind: 'openai-compat', label: 'LM Studio', url: 'http://localhost:1234/v1' }, 'sk-x')).rejects.toThrow(/vault/);
    await expect(core.providers.add({ kind: 'openai-compat', label: 'LM Studio', url: 'http://localhost:1234/v1' })).resolves.toMatchObject({ label: 'LM Studio' });
  });
});

describe('createCore — the updates (task 13.1)', () => {
  const opened: { close(): Promise<void> }[] = [];
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((one) => one.close()));
  });

  /** A new version of the setup's `gemma-4-test.gguf`, published on a hub of the test. */
  async function newVersion(dir: string): Promise<{ entry: CatalogueEntry; hub: FakeModelHub }> {
    const file = join(dir, 'gemma-4-test-v2.gguf');
    await writeFakeGguf(file, { paddingBytes: 6000 });
    const body = await readFile(file);
    const entry: CatalogueEntry = {
      id: 'gemma-4-test',
      family: 'gemma',
      name: 'Gemma 4 test',
      repo: 'google/gemma-4-test-gguf',
      file: 'gemma-4-test-v2.gguf',
      bytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
      context: 8192,
      fromGiB: 0,
      replaces: ['gemma-4-test.gguf'],
    };
    const hub = await startFakeModelHub({ files: { 'google/gemma-4-test-gguf/gemma-4-test-v2.gguf': body } });
    opened.push(hub);
    return { entry, hub };
  }

  async function withMemory() {
    const scratch = await mkdtemp(join(tmpdir(), 'bp-upd-'));
    dirs.push(scratch);
    const { entry, hub } = await newVersion(scratch);
    const set = await setup({ modelHub: hub.url, modelCatalogue: [entry] });
    await set.core.loadModel(set.gemma);
    await set.core.conversationStore.ensure('c1', { kind: 'code', engineId: 'builtin', modelId: set.gemma, mode: 'repetition' });
    await set.core.conversations.turn('c1', { text: 'Bonjour' }, () => undefined);
    await set.core.unloadModel();
    return { ...set, entry, hub };
  }

  it('offers a new version of a model on the disk, with the conversations it makes to read again — downloading nothing', async () => {
    const { core, gemma, entry, hub } = await withMemory();
    const updates = await core.updates();
    expect(updates.llama).toBeNull();
    expect(updates.busy).toBe(false);
    expect(updates.models).toEqual([
      {
        id: 'gemma-4-test',
        name: 'Gemma 4 test',
        file: 'gemma-4-test-v2.gguf',
        bytes: entry.bytes,
        replaces: gemma,
        reread: { conversations: 1, tokens: expect.any(Number), seconds: expect.any(Number) },
        downloading: null,
      },
    ]);
    expect(updates.models[0]!.reread.tokens).toBeGreaterThan(0);
    expect(hub.downloads).toBe(0);
  }, 20_000);

  it('« Télécharger » downloads it, moves those conversations onto it, and keeps the old file', async () => {
    const { core, gemma, dir } = await withMemory();
    await core.updateModel('gemma-4-test');
    const kept = join(dir, 'data', 'models', 'gemma-4-test-v2.gguf');
    expect((await core.conversationStore.get('c1'))?.modelId).toBe(kept);
    expect((await readdir(join(dir, 'models')))).toContain('gemma-4-test.gguf');
    expect((await core.updates()).models).toEqual([]);
    expect(gemma).not.toBe(kept);
    // A load brings the new one back from now on.
    expect(await core.settings.get('defaultModel')).toBe(kept);
  }, 20_000);

  it('with the old version running, the new one takes its place once downloaded', async () => {
    const { core, gemma, dir } = await withMemory();
    await core.loadModel(gemma);
    await core.updateModel('gemma-4-test');
    expect(await core.engineState()).toMatchObject({ status: 'ready', model: { path: join(dir, 'data', 'models', 'gemma-4-test-v2.gguf') } });
  }, 30_000);

  it('counts a conversation whose memory is still in the engine', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'bp-upd-'));
    dirs.push(scratch);
    const { entry, hub } = await newVersion(scratch);
    const { core, gemma } = await setup({ modelHub: hub.url, modelCatalogue: [entry] });
    await core.loadModel(gemma);
    await core.conversationStore.ensure('c2', { kind: 'code', engineId: 'builtin', modelId: '', mode: 'repetition' });
    await core.conversations.turn('c2', { text: 'Bonjour' }, () => undefined);
    expect((await core.updates()).models[0]?.reread.conversations).toBe(1);
  }, 20_000);

  it('counts the conversation whose turn holds the engine right now', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'bp-upd-'));
    dirs.push(scratch);
    const { entry, hub } = await newVersion(scratch);
    const { core, gemma } = await setup({ modelHub: hub.url, modelCatalogue: [entry] });
    await core.loadModel(gemma);
    await core.conversationStore.ensure('c3', { kind: 'code', engineId: 'builtin', modelId: '', mode: 'repetition' });
    let during: Promise<number | undefined> | undefined;
    await core.conversations.turn('c3', { text: 'Bonjour' }, () => {
      during ??= core.updates().then((view) => view.models[0]?.reread.conversations);
    });
    expect(await during).toBe(1);
  }, 20_000);

  it('« Garder la version actuelle » never offers it again', async () => {
    const { core, hub } = await withMemory();
    await core.keepModel('gemma-4-test');
    expect((await core.updates()).models).toEqual([]);
    expect(hub.downloads).toBe(0);
  }, 20_000);

  it('updates llama.cpp only once no reply holds the engine, then loads the same model again', async () => {
    const github = await startFakeLlamaReleases({ build: 'b12383' });
    opened.push(github);
    const { core, gemma } = await setup({ llamaReleases: github.url });
    expect((await core.updates({ check: true })).llama).toEqual({ build: 'b12383', bytes: github.bytes, installing: null });
    await core.loadModel(gemma);
    const release = core.hold();
    const updating = core.updateLlamaCpp();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(github.downloads).toBe(0);
    release();
    await updating;
    expect(github.downloads).toBe(1);
    expect(await core.engineState()).toMatchObject({ status: 'ready', model: { path: gemma } });
    expect((await core.updates()).llama).toBeNull();
  }, 30_000);

  it('whenIdle waits for the reply that holds the engine', async () => {
    const { core } = await setup();
    await core.whenIdle();
    const release = core.hold();
    let idle = false;
    const waiting = core.whenIdle().then(() => (idle = true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(idle).toBe(false);
    release();
    await waiting;
  });
});
