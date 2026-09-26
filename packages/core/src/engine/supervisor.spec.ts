/**
 * EngineSupervisor — the life cycle of the llama-server bonaparte manages,
 * extracted from the Electron harness so that it can be tested here, against
 * the fake server, with a fake spawn.
 *
 * What it owns: ONE backend at a time, the model it serves, the launch
 * parameters (context size, cache types — they belong to the engine, not to
 * the conversation: D-17), the `LiveBackendConfig` a KV manifest is checked
 * against, and the trace of the spawned process so an orphan can be killed
 * at the next start.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProcessHandle, SpawnFn } from '../backend/llamacpp/llamacpp-backend.js';
import type { BackendStatus } from '../backend/types.js';
import {
  startFakeLlamaServer,
  type FakeLlamaServer,
} from '../testing/fake-llama-server.js';
import { EngineSupervisor, type EngineSupervisorOptions } from './supervisor.js';
import { MeasureStore } from './measures.js';

let servers: FakeLlamaServer[] = [];
let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

async function fakeServer(): Promise<FakeLlamaServer> {
  const server = await startFakeLlamaServer({ msPerToken: 1, responder: () => 'ok' });
  servers.push(server);
  return server;
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-supervisor-'));
  dirs.push(dir);
  return dir;
}

interface FakeSpawn {
  spawnFn: SpawnFn;
  calls: { binPath: string; args: string[] }[];
  kills: number;
  triggerExit(code: number | null): void;
}

function makeFakeSpawn(pid = 4242): FakeSpawn {
  const state = {
    calls: [] as { binPath: string; args: string[] }[],
    kills: 0,
    exitCb: null as ((code: number | null) => void) | null,
  };
  return {
    calls: state.calls,
    get kills() {
      return state.kills;
    },
    spawnFn: (binPath, args) => {
      state.calls.push({ binPath, args });
      const handle: ProcessHandle = {
        pid,
        onExit: (cb) => {
          state.exitCb = cb;
        },
        kill: () => {
          state.kills += 1;
        },
      };
      return handle;
    },
    triggerExit: (code) => state.exitCb?.(code),
  };
}

const MODEL_A = 'D:\\models\\qwen3-a.gguf';
const MODEL_B = 'D:\\models\\qwen3-b.gguf';

async function makeSupervisor(
  server: FakeLlamaServer,
  spawn: FakeSpawn,
  overrides: Partial<EngineSupervisorOptions> = {},
): Promise<{ supervisor: EngineSupervisor; dir: string }> {
  const dir = await tempDir();
  const supervisor = new EngineSupervisor({
    slotsDir: join(dir, 'kv-slots'),
    pidFile: join(dir, 'managed-server.pid'),
    spawnFn: spawn.spawnFn,
    port: server.port,
    baseUrl: server.url,
    fingerprint: async (modelPath) => `fp:${modelPath}`,
    buildTag: async () => 'b9999',
    commandPrefix: () => [],
    healthIntervalMs: 5,
    healthTimeoutMs: 300,
    ...overrides,
  });
  return { supervisor, dir };
}

const MANAGED = {
  mode: 'managed' as const,
  binPath: 'C:\\bin\\llama-server.exe',
  nCtx: 4096,
  cacheType: 'f16' as const,
};

describe('EngineSupervisor — managed engine', () => {
  it('configuring registers the engine without spawning anything', async () => {
    // Cold start rule: launching the app loads no model. The engine is known,
    // not running, until a conversation asks for a model.
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const { supervisor } = await makeSupervisor(server, spawn);

    await supervisor.configure(MANAGED);

    expect(spawn.calls).toHaveLength(0);
    expect(supervisor.status()).toBe('stopped');
    expect(supervisor.backend).toBeNull();
    expect(supervisor.live).toBeNull();
  });

  it('ensureLoaded spawns once, with the model and the engine context size, and describes the live config', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const { supervisor } = await makeSupervisor(server, spawn);
    await supervisor.configure(MANAGED);

    await supervisor.ensureLoaded(MODEL_A);

    expect(spawn.calls).toHaveLength(1);
    const args = spawn.calls[0]!.args.join(' ');
    expect(args).toContain(MODEL_A);
    expect(args).toContain('4096');
    expect(supervisor.status()).toBe('ready');
    expect(supervisor.loaded).toEqual({ modelPath: MODEL_A, nCtx: 4096 });
    expect(supervisor.live).toEqual({
      modelFingerprint: `fp:${MODEL_A}`,
      nCtx: 4096,
      cacheTypeK: 'f16',
      cacheTypeV: 'f16',
      buildTag: 'b9999',
    });
    expect(supervisor.backend?.slots).toBeDefined();
  });

  it('measures how long a model took to load — what a switch to it will cost next time', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const { supervisor } = await makeSupervisor(server, spawn);
    await supervisor.configure(MANAGED);
    expect(supervisor.loadSeconds(MODEL_A)).toBeUndefined();

    await supervisor.ensureLoaded(MODEL_A);

    expect(supervisor.loadSeconds(MODEL_A)).toBeGreaterThanOrEqual(0);
    expect(supervisor.loadSeconds(MODEL_B)).toBeUndefined();
  });

  it('load times go through the measures it is given: a model measured at the last launch is known at once', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const measures = new MeasureStore();
    measures.record(MODEL_B, { loadSeconds: 42 });
    const { supervisor } = await makeSupervisor(server, spawn, { measures });
    expect(supervisor.loadSeconds(MODEL_B)).toBe(42);

    await supervisor.configure(MANAGED);
    await supervisor.ensureLoaded(MODEL_A);

    expect(measures.get(MODEL_A)?.loadSeconds).toBeGreaterThanOrEqual(0);
    expect(supervisor.loadSeconds(MODEL_A)).toBe(measures.get(MODEL_A)?.loadSeconds);
  });

  it('the same model does not relaunch — two conversations on one model share the server', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const { supervisor } = await makeSupervisor(server, spawn);
    await supervisor.configure(MANAGED);
    await supervisor.ensureLoaded(MODEL_A);
    const first = supervisor.backend;

    await supervisor.ensureLoaded(MODEL_A);

    expect(spawn.calls).toHaveLength(1);
    expect(spawn.kills).toBe(0);
    expect(supervisor.backend).toBe(first);
  });

  it('another model lets the caller save its state, then stops the previous server, then launches', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const order: string[] = [];
    const { supervisor } = await makeSupervisor(server, spawn, {
      beforeUnload: async () => {
        order.push(`save:${spawn.kills}:${spawn.calls.length}`);
      },
    });
    await supervisor.configure(MANAGED);
    await supervisor.ensureLoaded(MODEL_A);

    await supervisor.ensureLoaded(MODEL_B);

    // The save happened while the first server was still alive (0 kills,
    // 1 spawn), then the kill, then the second spawn.
    expect(order).toEqual(['save:0:1']);
    expect(spawn.kills).toBe(1);
    expect(spawn.calls).toHaveLength(2);
    expect(spawn.calls[1]!.args.join(' ')).toContain(MODEL_B);
    expect(supervisor.loaded).toEqual({ modelPath: MODEL_B, nCtx: 4096 });
    expect(supervisor.live?.modelFingerprint).toBe(`fp:${MODEL_B}`);
  });

  it('a crashed server is relaunched by the next ensureLoaded, even for the same model', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const { supervisor } = await makeSupervisor(server, spawn);
    await supervisor.configure(MANAGED);
    await supervisor.ensureLoaded(MODEL_A);
    // The backend's own bounded restart is exhausted: it reports 'crashed'.
    await supervisor.stop();
    expect(supervisor.status()).toBe('stopped');

    await supervisor.ensureLoaded(MODEL_A);

    expect(spawn.calls).toHaveLength(2);
    expect(supervisor.status()).toBe('ready');
  });

  it('status changes reach a listener registered before the launch, and survive a model switch', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const { supervisor } = await makeSupervisor(server, spawn);
    const seen: BackendStatus[] = [];
    supervisor.onStatusChange((status) => seen.push(status));
    await supervisor.configure(MANAGED);

    await supervisor.ensureLoaded(MODEL_A);
    await supervisor.ensureLoaded(MODEL_B);

    // starting → ready for A, stopped for A, starting → ready for B.
    expect(seen).toEqual(['starting', 'ready', 'stopped', 'starting', 'ready']);
  });

  it('reconfiguring tears the running server down', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const { supervisor } = await makeSupervisor(server, spawn);
    await supervisor.configure(MANAGED);
    await supervisor.ensureLoaded(MODEL_A);

    await supervisor.configure({ ...MANAGED, nCtx: 8192 });

    expect(spawn.kills).toBe(1);
    expect(supervisor.status()).toBe('stopped');
    expect(supervisor.backend).toBeNull();
    expect(supervisor.live).toBeNull();
    expect(supervisor.loaded).toBeNull();
  });

  it('ensureLoaded refuses when no engine is configured, and when the engine is remote it does nothing', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const { supervisor } = await makeSupervisor(server, spawn);

    await expect(supervisor.ensureLoaded(MODEL_A)).rejects.toThrow(/not configured/i);

    await supervisor.configure({ mode: 'remote', url: server.url });
    await supervisor.connect();
    await supervisor.ensureLoaded(MODEL_A);
    expect(spawn.calls).toHaveLength(0);
  });
});

describe('EngineSupervisor — remote engine', () => {
  it('connects on demand and describes what the server serves', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const { supervisor } = await makeSupervisor(server, spawn);
    await supervisor.configure({ mode: 'remote', url: server.url });
    expect(supervisor.status()).toBe('stopped');

    const status = await supervisor.connect();

    expect(status).toBe('ready');
    expect(spawn.calls).toHaveLength(0);
    expect(supervisor.live).toMatchObject({ nCtx: 0, cacheTypeK: 'f16' });
    expect(supervisor.live?.modelFingerprint).toMatch(/^remote:/);
    expect(supervisor.loaded?.modelPath).toBeTruthy();
  });
});

describe('EngineSupervisor — orphan trace', () => {
  it('spawning records the pid; a clean stop forgets it', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn(31337);
    const { supervisor, dir } = await makeSupervisor(server, spawn);
    await supervisor.configure(MANAGED);

    await supervisor.ensureLoaded(MODEL_A);
    expect((await readFile(join(dir, 'managed-server.pid'), 'utf8')).trim()).toBe('31337');

    // No exit event here: on a real shutdown Electron quits right after
    // stop() resolves, before the child's 'exit' fires. The kill is
    // synchronous (taskkill /F); the trace must go with it.
    await supervisor.stop();
    await expect(readFile(join(dir, 'managed-server.pid'), 'utf8')).rejects.toThrow();
  });

  it('a pid left by a session that died is killed at the next start, if it is still a llama', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const killed: number[] = [];
    const { supervisor, dir } = await makeSupervisor(server, spawn, {
      processProbe: {
        isLlama: (pid) => pid === 777,
        kill: (pid) => {
          killed.push(pid);
        },
      },
    });
    await writeFile(join(dir, 'managed-server.pid'), '777', 'utf8');

    await supervisor.killOrphan();

    expect(killed).toEqual([777]);
    await expect(readFile(join(dir, 'managed-server.pid'), 'utf8')).rejects.toThrow();
  });

  it('a recycled pid that is no longer a llama is left alone', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const killed: number[] = [];
    const { supervisor, dir } = await makeSupervisor(server, spawn, {
      processProbe: {
        isLlama: () => false,
        kill: (pid) => {
          killed.push(pid);
        },
      },
    });
    await writeFile(join(dir, 'managed-server.pid'), '777', 'utf8');

    await supervisor.killOrphan();

    expect(killed).toEqual([]);
    await expect(readFile(join(dir, 'managed-server.pid'), 'utf8')).rejects.toThrow();
  });
});
