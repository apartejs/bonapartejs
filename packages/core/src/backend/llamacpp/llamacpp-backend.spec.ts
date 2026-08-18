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
  calls: { binPath: string; args: string[] }[];
  killCount: number;
  triggerExit(code: number | null): void;
}

function makeFakeSpawn(): FakeSpawn {
  const state = {
    calls: [] as { binPath: string; args: string[] }[],
    killCount: 0,
    exitCb: null as ((code: number | null) => void) | null,
  };
  const fake: FakeSpawn = {
    calls: state.calls,
    get killCount() {
      return state.killCount;
    },
    spawnFn: (binPath, args) => {
      state.calls.push({ binPath, args });
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
  }> = {},
): Backend {
  return createLlamaCppBackend({
    mode: 'managed',
    binPath: 'C:\\bin\\llama-server.exe',
    launch: {
      modelPath: 'D:\\models\\qwen3.gguf',
      port: server.port,
      ...(overrides.slotSavePath ? { slotSavePath: overrides.slotSavePath } : {}),
    },
    spawnFn: spawn.spawnFn,
    baseUrl: overrides.baseUrl ?? server.url,
    healthIntervalMs: 5,
    healthTimeoutMs: 300,
    maxRestarts: overrides.maxRestarts ?? 2,
  });
}

describe('createLlamaCppBackend — managed', () => {
  it('démarre : spawn avec les bons args, poll health, statut ready', async () => {
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

  it('échoue au démarrage si health ne répond jamais : crashed + kill', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const backend = managed(server, spawn, { baseUrl: 'http://127.0.0.1:1' });

    await expect(backend.start()).rejects.toThrow();
    expect(backend.status()).toBe('crashed');
    expect(spawn.killCount).toBe(1);
  });

  it('redémarre après une sortie inattendue (borné par maxRestarts)', async () => {
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

  it('abandonne (crashed) quand maxRestarts est épuisé', async () => {
    const server = await fakeServer();
    const spawn = makeFakeSpawn();
    const backend = managed(server, spawn, { maxRestarts: 0 });

    await backend.start();
    spawn.triggerExit(1);

    await vi.waitFor(() => expect(backend.status()).toBe('crashed'));
    expect(spawn.calls).toHaveLength(1);
  });

  it('stop() est intentionnel : kill, statut stopped, pas de restart', async () => {
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

  it('slots présent si et seulement si slotSavePath est configuré', async () => {
    const server = await fakeServer();
    const withSlots = managed(server, makeFakeSpawn(), { slotSavePath: 'C:\\kv' });
    const withoutSlots = managed(server, makeFakeSpawn());
    expect(withSlots.slots).toBeDefined();
    expect(withSlots.capabilities.kvPersistence).toBe(true);
    expect(withoutSlots.slots).toBeUndefined();
    expect(withoutSlots.capabilities.kvPersistence).toBe(false);
  });
});

describe('createLlamaCppBackend — remote', () => {
  it('start() vérifie la santé puis délègue complete() au serveur', async () => {
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

  it('start() échoue proprement si le serveur distant est injoignable', async () => {
    const backend = createLlamaCppBackend({
      mode: 'remote',
      url: 'http://127.0.0.1:1',
    });
    await expect(backend.start()).rejects.toThrow();
    expect(backend.status()).toBe('crashed');
  });

  it('kvPersistence distant est déclaratif (défaut true, désactivable)', async () => {
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
