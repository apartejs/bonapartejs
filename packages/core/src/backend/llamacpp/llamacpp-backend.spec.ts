import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startFakeLlamaServer,
  type FakeLlamaServer,
} from '../../testing/fake-llama-server.js';
import type { Backend, BackendStatus } from '../types.js';
import {
  createLlamaCppBackend,
  type ProcessHandle,
  type SpawnFn,
} from './llamacpp-backend.js';

let servers: FakeLlamaServer[] = [];

async function fakeServer(
  ...args: Parameters<typeof startFakeLlamaServer>
): Promise<FakeLlamaServer> {
  const server = await startFakeLlamaServer(...args);
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

interface FakeSpawn {
  spawnFn: SpawnFn;
  calls: { binPath: string; args: string[]; env?: Record<string, string> }[];
  killCount: number;
  triggerExit(code: number | null): void;
}

function makeFakeSpawn(): FakeSpawn {
  const state = {
    calls: [] as { binPath: string; args: string[]; env?: Record<string, string> }[],
    killCount: 0,
    exitCb: null as ((code: number | null) => void) | null,
  };
  const fake: FakeSpawn = {
    calls: state.calls,
    get killCount() {
      return state.killCount;
    },
    spawnFn: (binPath, args, env) => {
      state.calls.push({ binPath, args, ...(env ? { env } : {}) });
      const handle: ProcessHandle = {
        onExit: (cb) => {
          state.exitCb = cb;
        },
        kill: () => {
          state.killCount += 1;
        },
      };
      return handle;
    },
    triggerExit: (code) => {
      state.exitCb?.(code);
    },
  };
  return fake;
}

function trackStatuses(backend: Backend): BackendStatus[] {
  const statuses: BackendStatus[] = [];
  backend.onStatusChange((s) => statuses.push(s));
  return statuses;
}

function managed(
  server: FakeLlamaServer,
  spawn: FakeSpawn,
  overrides: Partial<{
    slotSavePath: string;
    maxRestarts: number;
    baseUrl: string;
    verifyModel: boolean;
    modelPath: string;
  }> = {},
): Backend {
  return createLlamaCppBackend({
    mode: 'managed',
    binPath: 'C:\\bin\\llama-server.exe',
    launch: {
      modelPath: overrides.modelPath ?? 'D:\\models\\qwen3.gguf',
      port: server.port,
      ...(overrides.slotSavePath ? { slotSavePath: overrides.slotSavePath } : {}),
    },
    spawnFn: spawn.spawnFn,
    baseUrl: overrides.baseUrl ?? server.url,
    healthIntervalMs: 5,
    healthTimeoutMs: 300,
    maxRestarts: overrides.maxRestarts ?? 2,
    ...(overrides.verifyModel !== undefined ? { verifyModel: overrides.verifyModel } : {}),
  });
}

describe('createLlamaCppBackend — managed', () => {
  it('starts: spawns with the right args, polls health, status ready', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const backend = managed(server, spawn, { slotSavePath: 'C:\\bp\\kv' });
    const statuses = trackStatuses(backend);

    await backend.start();

    expect(backend.status()).toBe('ready');
    expect(statuses).toEqual(['starting', 'ready']);
    expect(spawn.calls).toHaveLength(1);
    const args = spawn.calls[0]!.args;
    expect(args).toContain('-fa');
    expect(args).toContain('D:\\models\\qwen3.gguf');
    expect(args).toContain('--slot-save-path');
  });

  it('fails to start if health never responds: crashed + kill', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const backend = managed(server, spawn, { baseUrl: 'http://127.0.0.1:1' });

    await expect(backend.start()).rejects.toThrow();
    expect(backend.status()).toBe('crashed');
    expect(spawn.killCount).toBe(1);
  });

  it('restarts after an unexpected exit (bounded by maxRestarts)', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const backend = managed(server, spawn);
    const statuses = trackStatuses(backend);

    await backend.start();
    spawn.triggerExit(1);

    await vi.waitFor(() => expect(backend.status()).toBe('ready'));
    expect(spawn.calls).toHaveLength(2);
    expect(statuses).toContain('restarting');
  });

  it('gives up (crashed) when maxRestarts is exhausted', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const backend = managed(server, spawn, { maxRestarts: 0 });

    await backend.start();
    spawn.triggerExit(1);

    await vi.waitFor(() => expect(backend.status()).toBe('crashed'));
    expect(spawn.calls).toHaveLength(1);
  });

  it('stop() is intentional: kill, status stopped, no restart', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const backend = managed(server, spawn);

    await backend.start();
    await backend.stop();
    spawn.triggerExit(0);

    await new Promise((r) => setTimeout(r, 30));
    expect(backend.status()).toBe('stopped');
    expect(spawn.killCount).toBe(1);
    expect(spawn.calls).toHaveLength(1);
  });

  it('slots present if and only if slotSavePath is configured', async () => {
    const server = await fakeServer();
    const withSlots = managed(server, makeFakeSpawn(), { slotSavePath: 'C:\\kv' });
    const withoutSlots = managed(server, makeFakeSpawn());
    expect(withSlots.slots).toBeDefined();
    expect(withSlots.capabilities.kvPersistence).toBe(true);
    expect(withoutSlots.slots).toBeUndefined();
    expect(withoutSlots.capabilities.kvPersistence).toBe(false);
  });
});

describe('createLlamaCppBackend — the managed server answers to us alone (audit 07, C1/C2)', () => {
  it('launches with a random API key in its environment — never on the command line — and every request carries it', async () => {
    let key: string | undefined;
    const server = await fakeServer({ apiKey: () => key });
    const spawn = makeFakeSpawn();
    const original = spawn.spawnFn;
    spawn.spawnFn = (binPath, args, env) => {
      key = env?.['LLAMA_API_KEY'];
      return original(binPath, args, env);
    };
    const backend = managed(server, spawn);

    await backend.start();

    expect(key).toMatch(/^[\w-]{32,}$/);
    expect(spawn.calls[0]!.args.join(' ')).not.toContain(key!);
    await expect(backend.props()).resolves.toBeDefined();
    // Anyone else — a web page, another process — is refused.
    expect((await fetch(`${server.url}/props`)).status).toBe(401);
  });

  it('two launches get two different keys', async () => {
    const server = await fakeServer();
    const a = makeFakeSpawn();
    const b = makeFakeSpawn();
    await managed(server, a).start();
    await managed(server, b).start();
    expect(a.calls[0]!.env?.['LLAMA_API_KEY']).not.toBe(b.calls[0]!.env?.['LLAMA_API_KEY']);
  });

  it('the web UI is off', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    await managed(server, spawn).start();
    expect(spawn.calls[0]!.args).toContain('--no-webui');
  });

  it('a server on the port that serves another model is not ours: refused, killed, crashed', async () => {
    const server = await fakeServer({ modelPath: 'C:\\elsewhere\\other.gguf' });
    const spawn = makeFakeSpawn();
    const backend = managed(server, spawn, { verifyModel: true });

    await expect(backend.start()).rejects.toThrow(/other\.gguf/);
    expect(backend.status()).toBe('crashed');
    expect(spawn.killCount).toBe(1);
  });

  it('the same model is recognised through case and separator differences', async () => {
    const server = await fakeServer({ modelPath: 'd:/Models/QWEN3.gguf' });
    const backend = managed(server, makeFakeSpawn(), {
      verifyModel: true,
      modelPath: 'D:\\models\\qwen3.gguf',
    });
    await backend.start();
    expect(backend.status()).toBe('ready');
  });
});

describe('createLlamaCppBackend — unified CLI', () => {
  it('prefixes the args with the subcommand when commandPrefix is provided', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const backend = createLlamaCppBackend({
      mode: 'managed',
      binPath: 'C:\\WindowsApps\\llama.exe',
      launch: { modelPath: 'D:\\models\\qwen3.gguf', port: server.port },
      spawnFn: spawn.spawnFn,
      baseUrl: server.url,
      healthIntervalMs: 5,
      healthTimeoutMs: 300,
      commandPrefix: ['serve'],
    });
    await backend.start();
    expect(spawn.calls[0]!.args[0]).toBe('serve');
    expect(spawn.calls[0]!.args).toContain('-m');
  });
});

describe('createLlamaCppBackend — remote', () => {
  it('start() checks health then delegates complete() to the server', async () => {
    const server = await fakeServer({ responder: () => 'coucou' });
    const backend = createLlamaCppBackend({ mode: 'remote', url: server.url });

    await backend.start();
    expect(backend.status()).toBe('ready');

    let text = '';
    for await (const event of backend.complete({ prompt: 'salut' })) {
      if (event.type === 'token') text += event.text;
    }
    expect(text).toBe('coucou');

    const props = await backend.props();
    expect(props.totalSlots).toBeGreaterThan(0);
  });

  it('start() fails cleanly if the remote server is unreachable', async () => {
    const backend = createLlamaCppBackend({
      mode: 'remote',
      url: 'http://127.0.0.1:1',
    });
    await expect(backend.start()).rejects.toThrow();
    expect(backend.status()).toBe('crashed');
  });

  it('remote kvPersistence is declarative (default true, can be disabled)', async () => {
    const server = await fakeServer();
    const on = createLlamaCppBackend({ mode: 'remote', url: server.url });
    const off = createLlamaCppBackend({
      mode: 'remote',
      url: server.url,
      assumeKvPersistence: false,
    });
    expect(on.capabilities.kvPersistence).toBe(true);
    expect(on.slots).toBeDefined();
    expect(off.capabilities.kvPersistence).toBe(false);
    expect(off.slots).toBeUndefined();
  });
});
