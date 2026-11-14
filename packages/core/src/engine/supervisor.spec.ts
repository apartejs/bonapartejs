/**
 * The engine supervisor owns the one llama-server bonaparte talks to: it
 * launches it on demand, replaces it when the model changes, unloads it when
 * nothing has worked for a while, and kills the one an earlier session left
 * behind — only if it is really ours. These tests launch the fake binary.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendStatus } from '../backend/types.js';
import { spawnHidden, type SpawnFn, type SpawnHiddenOptions } from '../process/spawn.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';
import { MeasureStore } from './measures.js';
import type { ProcessProbe } from './process-probe.js';
import { EngineSupervisor, type EngineSupervisorOptions } from './supervisor.js';

const BIN = fileURLToPath(new URL('../testing/fake-llama-bin.mjs', import.meta.url));

let supervisors: EngineSupervisor[] = [];
let dirs: string[] = [];
let remotes: FakeLlamaServer[] = [];
afterEach(async () => {
  await Promise.all(supervisors.map((supervisor) => supervisor.stop()));
  await Promise.all(remotes.map((server) => server.close()));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  supervisors = [];
  dirs = [];
  remotes = [];
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

type Launch = { command: string; args: readonly string[]; options: Parameters<SpawnFn>[2] };

async function setup(overrides: Partial<EngineSupervisorOptions> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bp-supervisor-'));
  dirs.push(dir);
  const modelA = join(dir, 'a.gguf');
  const modelB = join(dir, 'b.gguf');
  await writeFile(modelA, 'model a');
  await writeFile(modelB, 'model b');
  const launches: Launch[] = [];
  const spawn: SpawnFn = (command, args, options) => {
    launches.push({ command, args, options });
    return spawnHidden(command, args, options as SpawnHiddenOptions);
  };
  const lines: string[] = [];
  const statuses: BackendStatus[] = [];
  const supervisor = new EngineSupervisor({
    slotsDir: join(dir, 'kv-slots'),
    pidFile: join(dir, 'managed-server.pid'),
    port: await freePort(),
    llamaCommand: [process.execPath, BIN],
    spawn,
    logger: (line) => lines.push(line),
    healthIntervalMs: 50,
    healthTimeoutMs: 15_000,
    ...overrides,
  });
  supervisor.onStatusChange((status) => statuses.push(status));
  supervisors.push(supervisor);
  const serverLaunches = () => launches.filter((launch) => launch.command === process.execPath && !launch.args.includes('--version'));
  return { supervisor, dir, modelA, modelB, launches, serverLaunches, lines, statuses };
}

const MANAGED = { mode: 'managed', binPath: 'llama-server', nCtx: 4096 } as const;

const waitFor = async (check: () => boolean, ms = 10_000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waited in vain');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

describe('EngineSupervisor — a managed engine', () => {
  it('configuring launches nothing: starting the app never loads a model', async () => {
    const { supervisor, launches } = await setup();
    await supervisor.configure(MANAGED);
    expect(launches).toHaveLength(0);
    expect(supervisor.status()).toBe('stopped');
    expect(supervisor.loaded).toBeNull();
    expect(supervisor.client()).toBeUndefined();
  });

  it('loads a model on demand: one launch, then ready, with what the KV manifest needs', async () => {
    const { supervisor, modelA, serverLaunches } = await setup();
    await supervisor.configure(MANAGED);
    await supervisor.ensureLoaded(modelA);

    expect(serverLaunches()).toHaveLength(1);
    expect(supervisor.status()).toBe('ready');
    expect(supervisor.loaded).toEqual({ modelPath: modelA, nCtx: 4096 });
    expect(supervisor.live).toMatchObject({ nCtx: 4096, cacheTypeK: 'f16', cacheTypeV: 'f16', buildTag: 'version: 9999 (fake)' });
    expect(supervisor.live?.modelFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect((await supervisor.client()!.props()).modelPath).toBe(modelA);
  });

  it('launches through spawnHidden, on this machine only, with one slot and its key in the environment', async () => {
    const { supervisor, modelA, serverLaunches } = await setup();
    await supervisor.configure(MANAGED);
    await supervisor.ensureLoaded(modelA);
    const [launch] = serverLaunches();
    expect(launch!.options).toMatchObject({ shell: false, windowsHide: true });
    const args = launch!.args;
    expect(args[args.indexOf('-np') + 1]).toBe('1');
    expect(args[args.indexOf('--host') + 1]).toBe('127.0.0.1');
    expect((launch!.options.env as Record<string, string>)['LLAMA_API_KEY']).toMatch(/^[\w-]{32,}$/);
  });

  it('never writes the key in its log, even when the server prints it', async () => {
    const { supervisor, modelA, serverLaunches, lines } = await setup({ baseEnv: { ...process.env, FAKE_LLAMA_ECHO: '1' } });
    await supervisor.configure(MANAGED);
    await supervisor.ensureLoaded(modelA);
    await waitFor(() => lines.some((line) => line.includes('api key')));
    const key = (serverLaunches()[0]!.options.env as Record<string, string>)['LLAMA_API_KEY']!;
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(key);
  });

  it('the same model, ready: nothing is launched again', async () => {
    const { supervisor, modelA, serverLaunches } = await setup();
    await supervisor.configure(MANAGED);
    await supervisor.ensureLoaded(modelA);
    await supervisor.ensureLoaded(modelA);
    expect(serverLaunches()).toHaveLength(1);
  });

  it('another model: the caller saves first, while the old server still serves, then it is replaced', async () => {
    const order: string[] = [];
    const ctx: { supervisor?: EngineSupervisor } = {};
    const { supervisor, modelA, modelB, serverLaunches } = await setup({
      beforeUnload: async () => {
        const served = (await ctx.supervisor!.client()!.props()).modelPath;
        order.push(`save while ${served === modelA ? 'a' : '?'} serves`);
      },
    });
    ctx.supervisor = supervisor;
    await supervisor.configure(MANAGED);
    await supervisor.ensureLoaded(modelA);
    await supervisor.ensureLoaded(modelB);
    expect(order).toEqual(['save while a serves']);
    expect(serverLaunches()).toHaveLength(2);
    expect((await supervisor.client()!.props()).modelPath).toBe(modelB);
    expect(supervisor.loaded?.modelPath).toBe(modelB);
  });

  it('gives each slot the context asked, and reads in /props the context it really has', async () => {
    const { supervisor, modelA, serverLaunches, lines } = await setup();
    await supervisor.configure({ ...MANAGED, slots: 2 });
    await supervisor.ensureLoaded(modelA);
    const args = serverLaunches()[0]!.args;
    // -c is shared between the slots: two slots of 4096 need 8192.
    expect(args[args.indexOf('-c') + 1]).toBe('8192');
    expect(supervisor.loaded?.nCtx).toBe(4096);
    expect(lines.join('\n')).not.toMatch(/not the \d+ asked/);
  });

  it('says so when a slot does not have the context asked, and goes by the real one', async () => {
    const { supervisor, modelA, lines } = await setup({ baseEnv: { ...process.env, FAKE_LLAMA_UNIFIED: '1' } });
    await supervisor.configure({ ...MANAGED, slots: 2 });
    await supervisor.ensureLoaded(modelA);
    expect(supervisor.loaded?.nCtx).toBe(8192);
    expect(supervisor.live?.nCtx).toBe(8192);
    expect(lines.join('\n')).toMatch(/8192 tokens of context, not the 4096 asked/);
  });

  it('measures how long the model took to load, for the next announcement', async () => {
    const measures = new MeasureStore();
    const { supervisor, modelA } = await setup({ measures });
    await supervisor.configure(MANAGED);
    expect(supervisor.loadSeconds(modelA)).toBeUndefined();
    await supervisor.ensureLoaded(modelA);
    expect(supervisor.loadSeconds(modelA)).toBeGreaterThan(0);
    expect(measures.get(modelA)?.loadSeconds).toBe(supervisor.loadSeconds(modelA));
  });

  it('unloads the model after a while without work, saving first', async () => {
    let saved = 0;
    const { supervisor, modelA, lines } = await setup({
      idleUnloadMinutes: 0.005, // 300 ms
      beforeUnload: async () => {
        saved += 1;
      },
    });
    await supervisor.configure(MANAGED);
    await supervisor.ensureLoaded(modelA);
    await waitFor(() => supervisor.status() === 'stopped');
    expect(supervisor.loaded).toBeNull();
    expect(saved).toBe(1);
    expect(lines.join('\n')).toMatch(/unloaded/);
  });

  it('never unloads while a turn works, and counts the while from its end', async () => {
    const { supervisor, modelA } = await setup({ idleUnloadMinutes: 0.005 });
    await supervisor.configure(MANAGED);
    await supervisor.ensureLoaded(modelA);
    const release = supervisor.hold();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(supervisor.status()).toBe('ready');
    release();
    await waitFor(() => supervisor.status() === 'stopped');
  });

  it('a turn holds the engine before it loads the model: no unload while it works', async () => {
    const { supervisor, modelA } = await setup({ idleUnloadMinutes: 0.005 });
    await supervisor.configure(MANAGED);
    // The order of a turn: hold, load, generate, release.
    const release = supervisor.hold();
    await supervisor.ensureLoaded(modelA);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(supervisor.status()).toBe('ready');
    release();
    await waitFor(() => supervisor.status() === 'stopped');
  });

  it('says stopped only once it has forgotten what it served', async () => {
    const { supervisor, modelA } = await setup();
    await supervisor.configure(MANAGED);
    await supervisor.ensureLoaded(modelA);
    const seen: unknown[] = [];
    supervisor.onStatusChange((status) => {
      if (status === 'stopped') seen.push({ loaded: supervisor.loaded, live: supervisor.live, client: supervisor.client() });
    });
    await supervisor.stop();
    expect(seen).toEqual([{ loaded: null, live: null, client: undefined }]);
  });

  it('refuses to load before it is configured', async () => {
    const { supervisor, modelA } = await setup();
    await expect(supervisor.ensureLoaded(modelA)).rejects.toThrow(/not configured/);
  });

  it('refuses an engine binary that is not llama.cpp, when it is the one to run', async () => {
    const { supervisor } = await setup({ llamaCommand: undefined });
    await expect(
      supervisor.configure({ mode: 'managed', binPath: 'C:\\Windows\\System32\\cmd.exe', nCtx: 4096 }),
    ).rejects.toThrow(/llama/);
  });

  it('reconfiguring stops the server that the old configuration launched', async () => {
    const { supervisor, modelA } = await setup();
    await supervisor.configure(MANAGED);
    await supervisor.ensureLoaded(modelA);
    const client = supervisor.client()!;
    await supervisor.configure({ ...MANAGED, nCtx: 8192 });
    expect(supervisor.status()).toBe('stopped');
    expect(await client.health()).toBe(false);
  });
});

describe('EngineSupervisor — a remote engine', () => {
  it('joins the server it is pointed at, reads what it serves, and launches nothing', async () => {
    const { supervisor, modelA, launches } = await setup();
    const remote = await startFakeLlamaServer({ modelPath: 'D:\\remote\\qwen.gguf', nCtx: 16384 });
    remotes.push(remote);
    await supervisor.configure({ mode: 'remote', url: remote.url });
    expect(await supervisor.connect()).toBe('ready');
    await supervisor.ensureLoaded(modelA); // nothing to load: the remote serves what it serves
    expect(launches).toHaveLength(0);
    expect(supervisor.loaded).toEqual({ modelPath: 'D:\\remote\\qwen.gguf', nCtx: 16384 });
    expect(supervisor.live?.modelFingerprint).toBe('remote:D:\\remote\\qwen.gguf');
    expect(await supervisor.client()!.health()).toBe(true);
  });

  it('a remote server that does not answer: crashed, with its address', async () => {
    const { supervisor } = await setup();
    await supervisor.configure({ mode: 'remote', url: `http://127.0.0.1:${await freePort()}` });
    await expect(supervisor.connect()).rejects.toThrow(/127\.0\.0\.1/);
    expect(supervisor.status()).toBe('crashed');
  });
});

describe('EngineSupervisor — the server an earlier session left behind', () => {
  const probe = (commandLine: string | null) => {
    const killed: number[] = [];
    const processProbe: ProcessProbe = {
      commandLine: async () => commandLine,
      kill: async (pid) => {
        killed.push(pid);
      },
    };
    return { processProbe, killed };
  };

  it('writes down the pid of each launch, and forgets it on a clean stop', async () => {
    const { supervisor, dir, modelA } = await setup();
    await supervisor.configure(MANAGED);
    await supervisor.ensureLoaded(modelA);
    const trace = JSON.parse(await readFile(join(dir, 'managed-server.pid'), 'utf8')) as { pid: number };
    expect(trace.pid).toBe(supervisor.serverPid);
    await supervisor.stop();
    await expect(readFile(join(dir, 'managed-server.pid'), 'utf8')).rejects.toThrow();
  });

  it('kills it at the next start when its command line says it is ours', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bp-orphan-'));
    dirs.push(dir);
    const slotsDir = join(dir, 'kv-slots');
    const { processProbe, killed } = probe(`"C:\\llama\\llama-server.exe" -m x.gguf --slot-save-path ${slotsDir}`);
    const { supervisor } = await setup({ processProbe, slotsDir, pidFile: join(dir, 'managed-server.pid') });
    await writeFile(join(dir, 'managed-server.pid'), JSON.stringify({ pid: 777 }));
    await supervisor.killOrphan();
    expect(killed).toEqual([777]);
    await expect(readFile(join(dir, 'managed-server.pid'), 'utf8')).rejects.toThrow();
  });

  it('leaves alone a recycled pid: another program, or another llama-server', async () => {
    for (const commandLine of ['C:\\Windows\\notepad.exe', '"C:\\llama\\llama-server.exe" --slot-save-path D:\\elsewhere', null]) {
      const { processProbe, killed } = probe(commandLine);
      const { supervisor, dir } = await setup({ processProbe });
      await writeFile(join(dir, 'managed-server.pid'), JSON.stringify({ pid: 777 }));
      await supervisor.killOrphan();
      expect(killed).toEqual([]);
      await expect(readFile(join(dir, 'managed-server.pid'), 'utf8')).rejects.toThrow();
    }
  });

  it('a trace that cannot be read is forgotten, and nothing is killed', async () => {
    const { processProbe, killed } = probe('anything');
    const { supervisor, dir } = await setup({ processProbe });
    await writeFile(join(dir, 'managed-server.pid'), 'not json');
    await supervisor.killOrphan();
    expect(killed).toEqual([]);
    await expect(readFile(join(dir, 'managed-server.pid'), 'utf8')).rejects.toThrow();
  });
});
