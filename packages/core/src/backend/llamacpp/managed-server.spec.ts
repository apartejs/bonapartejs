/**
 * The llama-server bonaparte launches and watches: one key per launch, ready
 * only once it answers AND serves our model, relaunched after an unexpected
 * exit at most twice. These tests launch the fake binary for real.
 */

import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnHidden, type SpawnedProcess, type SpawnFn, type SpawnHiddenOptions } from '../../process/spawn.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../../testing/fake-llama-server.js';
import type { BackendStatus } from '../types.js';
import { ManagedServer, type ManagedServerOptions } from './managed-server.js';

const BIN = fileURLToPath(new URL('../../testing/fake-llama-bin.mjs', import.meta.url));
const MODEL = 'C:\\models\\qwen.gguf';

let servers: ManagedServer[] = [];
let foreign: FakeLlamaServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.stop()));
  await Promise.all(foreign.map((server) => server.close()));
  servers = [];
  foreign = [];
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

/** Records each launch, then really launches it (hidden). */
function recording() {
  const launches: Launch[] = [];
  const spawn: SpawnFn = (command, args, options) => {
    launches.push({ command, args, options });
    return spawnHidden(command, args, options as SpawnHiddenOptions);
  };
  return { spawn, launches };
}

/** A process that starts nothing and never leaves on its own. */
function inert() {
  let killed = 0;
  const spawn: SpawnFn = () => {
    const child = Object.assign(new EventEmitter(), {
      pid: undefined,
      exitCode: null as number | null,
      stderr: new EventEmitter(),
      kill(this: EventEmitter & { exitCode: number | null }) {
        killed += 1;
        this.exitCode = 1;
        this.emit('exit', null);
        return true;
      },
    });
    return child as unknown as SpawnedProcess;
  };
  return { spawn, killed: () => killed };
}

async function managed(overrides: Partial<ManagedServerOptions> = {}, launch: Partial<ManagedServerOptions['launch']> = {}) {
  const port = await freePort();
  const statuses: BackendStatus[] = [];
  const lines: string[] = [];
  const server = new ManagedServer({
    command: process.execPath,
    prefixArgs: [BIN],
    launch: { modelPath: MODEL, port, ...launch },
    healthIntervalMs: 50,
    healthTimeoutMs: 15_000,
    log: (line) => lines.push(line),
    ...overrides,
  });
  server.onStatusChange((status) => statuses.push(status));
  servers.push(server);
  return { server, port, statuses, lines };
}

const waitFor = async (check: () => boolean, ms = 15_000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waited in vain');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

describe('ManagedServer', () => {
  it('starts the server, waits until it serves, then says ready', async () => {
    const { server, port, statuses } = await managed();
    await server.start();
    expect(statuses).toEqual(['starting', 'ready']);
    expect(server.status()).toBe('ready');
    expect(await server.client.health()).toBe(true);
    expect((await server.client.props()).totalSlots).toBe(1);
    // Nobody else: a request without our key is refused.
    expect((await fetch(`http://127.0.0.1:${port}/props`)).status).toBe(401);
  });

  it('gives each launch a random key, in its environment, never in its arguments', async () => {
    const first = recording();
    const one = await managed({ spawn: first.spawn });
    await one.server.start();
    const second = recording();
    const two = await managed({ spawn: second.spawn });
    await two.server.start();

    const keyOf = (launch: Launch): string => String((launch.options.env as Record<string, string>)['LLAMA_API_KEY']);
    const key = keyOf(first.launches[0]!);
    expect(key).toMatch(/^[\w-]{32,}$/);
    expect(first.launches[0]!.args.join(' ')).not.toContain(key);
    expect(keyOf(second.launches[0]!)).not.toBe(key);
  });

  it('never lets the key reach the log, even when the server prints it', async () => {
    const launches = recording();
    const { server, lines } = await managed({
      spawn: launches.spawn,
      baseEnv: { ...process.env, FAKE_LLAMA_ECHO: '1' },
    });
    await server.start();
    await waitFor(() => lines.some((line) => line.includes('api key')));
    const key = String((launches.launches[0]!.options.env as Record<string, string>)['LLAMA_API_KEY']);
    expect(key).toMatch(/^[\w-]{32,}$/);
    expect(lines.join('\n')).not.toContain(key);
    expect(lines.join('\n')).toContain('api key ***');
  });

  it('reads the context one slot really has', async () => {
    const { server } = await managed({}, { nCtx: 8192, slots: 2 });
    await server.start();
    expect(server.slotContext).toBe(4096);
  });

  it('a server that stops before it is ready: a failure at once, with what it said', async () => {
    const { server } = await managed({ baseEnv: { ...process.env, FAKE_LLAMA_FAIL: 'cannot load the model' } });
    const started = Date.now();
    await expect(server.start()).rejects.toThrow(/cannot load the model/);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(server.status()).toBe('crashed');
  });

  it('a server that never answers: crashed after the time allowed, and stopped', async () => {
    const process = inert();
    const { server } = await managed({ spawn: process.spawn, healthTimeoutMs: 300, platform: 'linux' });
    await expect(server.start()).rejects.toThrow(/not responding/);
    expect(server.status()).toBe('crashed');
    expect(process.killed()).toBe(1);
  });

  it('a server that is not ours on the port is refused, never talked to', async () => {
    const process = inert();
    const { server, port } = await managed({ spawn: process.spawn, platform: 'linux' });
    foreign.push(await startFakeLlamaServer({ port, modelPath: 'C:\\models\\other.gguf' }));
    await expect(server.start()).rejects.toThrow(/other\.gguf/);
    expect(server.status()).toBe('crashed');
    expect(process.killed()).toBe(1);
  });

  it('a server on the port that refuses our key is not ours either', async () => {
    const process = inert();
    const { server, port } = await managed({ spawn: process.spawn, platform: 'linux' });
    foreign.push(await startFakeLlamaServer({ port, modelPath: MODEL, apiKey: 'somebody-else' }));
    await expect(server.start()).rejects.toThrow(/refuses our key/);
    expect(server.status()).toBe('crashed');
  });

  it('the same file, spelt another way, is our model', async () => {
    const process = inert();
    const { server, port } = await managed({ spawn: process.spawn, platform: 'linux' });
    foreign.push(await startFakeLlamaServer({ port, modelPath: 'c:/models/QWEN.gguf' }));
    await server.start();
    expect(server.status()).toBe('ready');
  });

  it('relaunches after an unexpected exit, at most twice, then says crashed', async () => {
    const launches = recording();
    const { server, statuses } = await managed({ spawn: launches.spawn });
    await server.start();
    for (let relaunch = 1; relaunch <= 2; relaunch += 1) {
      const pid = server.pid!;
      globalThis.process.kill(pid);
      await waitFor(() => server.status() === 'ready' && server.pid !== pid);
    }
    expect(statuses.filter((status) => status === 'restarting')).toHaveLength(2);
    globalThis.process.kill(server.pid!);
    await waitFor(() => server.status() === 'crashed');
    expect(launches.launches).toHaveLength(3);
  });

  it('stops: the port is free, and nothing relaunches', async () => {
    const launches = recording();
    const { server, port, statuses } = await managed({ spawn: launches.spawn });
    await server.start();
    await server.stop();
    expect(server.status()).toBe('stopped');
    expect(statuses.at(-1)).toBe('stopped');
    const answered = await fetch(`http://127.0.0.1:${port}/health`).then(
      () => true,
      () => false,
    );
    expect(answered).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(server.status()).toBe('stopped');
    // One launch of the server (on Windows the stop itself is a taskkill).
    expect(launches.launches.filter((launch) => launch.command === process.execPath)).toHaveLength(1);
  });

  it('tells who keeps the trace the pid of each launch, and when it is gone', async () => {
    const pids: (number | null)[] = [];
    const { server } = await managed({ onProcess: (pid) => pids.push(pid) });
    await server.start();
    const pid = server.pid;
    await server.stop();
    expect(pids).toEqual([pid, null]);
    expect(pid).toBeGreaterThan(0);
  });
});
