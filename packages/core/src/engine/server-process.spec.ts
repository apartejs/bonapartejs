/**
 * The process of the managed server: launched through spawnHidden, given an
 * environment without the person's secrets, and brought down with its whole
 * tree — the unified `llama` CLI is a launcher whose child is the real server.
 */

import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnHidden, type SpawnedProcess, type SpawnFn, type SpawnHiddenOptions } from '../process/spawn.js';
import { launchServer, serverEnvironment, type ServerProcess } from './server-process.js';

const BIN = fileURLToPath(new URL('../testing/fake-llama-bin.mjs', import.meta.url));

let launched: ServerProcess[] = [];
afterEach(async () => {
  await Promise.all(launched.map((one) => one.stop()));
  launched = [];
});

type Launch = { command: string; args: readonly string[]; options: Parameters<SpawnFn>[2] };

/** A spawn that records each launch, then really launches it (hidden). */
function recordingSpawn() {
  const launches: Launch[] = [];
  const spawn: SpawnFn = (command, args, options) => {
    launches.push({ command, args, options });
    return spawnHidden(command, args, options as SpawnHiddenOptions);
  };
  return { spawn, launches };
}

/** A child that never starts anything: for what happens around a process. */
function inertChild(pid?: number) {
  const child = Object.assign(new EventEmitter(), {
    pid,
    exitCode: null as number | null,
    stderr: new EventEmitter(),
    kill(this: { exitCode: number | null; emit(event: string, code: number): boolean }) {
      this.exitCode = 1;
      this.emit('exit', 1);
      return true;
    },
  });
  return child as unknown as SpawnedProcess;
}

describe('serverEnvironment', () => {
  it('gives the server its key, and none of the secrets of the person', () => {
    const env = serverEnvironment(
      {
        PATH: 'C:\\bin',
        OPENAI_API_KEY: 'sk-1',
        HF_TOKEN: 'hf-2',
        GITHUB_TOKEN: 'gh-3',
        AWS_SECRET_ACCESS_KEY: 'aws-4',
        DB_PASSWORD: 'pw-5',
        LLAMA_API_KEY: 'stale',
        CUDA_VISIBLE_DEVICES: '0',
      },
      'fresh-key',
    );
    expect(env).toEqual({ PATH: 'C:\\bin', CUDA_VISIBLE_DEVICES: '0', LLAMA_API_KEY: 'fresh-key' });
  });
});

describe('launchServer', () => {
  it('launches through spawnHidden: an argument array, no shell, no console window', async () => {
    const { spawn, launches } = recordingSpawn();
    const server = launchServer(process.execPath, [BIN, '--version'], { env: {}, spawn });
    launched.push(server);
    await server.exited;
    expect(launches[0]!.command).toBe(process.execPath);
    expect(launches[0]!.args).toEqual([BIN, '--version']);
    expect(launches[0]!.options).toMatchObject({ shell: false, windowsHide: true });
  });

  it('hands every line the server writes to the log', async () => {
    const lines: string[] = [];
    const server = launchServer(process.execPath, [BIN, '-m', 'm.gguf', '--port', '1'], {
      env: { ...serverEnvironment(process.env, 'k'), FAKE_LLAMA_FAIL: 'cannot load the model' },
      log: (line) => lines.push(line),
    });
    launched.push(server);
    expect(await server.exited).not.toBe(0);
    expect(lines.join('\n')).toContain('cannot load the model');
    expect(server.lastLines()).toContain('cannot load the model');
  });

  it('keeps the words of a line, not its colours: llama.cpp colours its log even into a pipe', async () => {
    const lines: string[] = [];
    const server = launchServer(process.execPath, [BIN, '-m', 'm.gguf', '--port', '1'], {
      env: {
        ...serverEnvironment(process.env, 'k'),
        FAKE_LLAMA_FAIL: '\u001b[34m0.03.648\u001b[0m \u001b[31mE llama_model_load: missing tensor\u001b[0m',
      },
      log: (line) => lines.push(line),
    });
    launched.push(server);
    await server.exited;
    expect(server.lastLines()).toBe('error: 0.03.648 E llama_model_load: missing tensor');
    expect(lines.join('\n')).not.toContain('\u001b');
  });

  it('stops a running server, and its exit is awaited', async () => {
    const server = launchServer(process.execPath, [BIN, '-m', 'm.gguf', '--port', '0'], {
      env: serverEnvironment(process.env, 'k'),
    });
    launched.push(server);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await server.stop();
    expect(server.running).toBe(false);
  });

  it('on Windows, brings down the whole tree with taskkill, through spawnHidden', async () => {
    const launches: Launch[] = [];
    const child = inertChild(4242);
    const spawn: SpawnFn = (command, args, options) => {
      launches.push({ command, args, options });
      if (command === 'taskkill') {
        // The tree goes down: the server's process with it.
        queueMicrotask(() => child.kill());
        return inertChild();
      }
      return child;
    };
    const server = launchServer('llama', ['serve'], { env: {}, spawn, platform: 'win32' });
    await server.stop();
    const kill = launches.find((launch) => launch.command === 'taskkill');
    expect(kill?.args).toEqual(['/pid', '4242', '/T', '/F']);
    expect(kill?.options).toMatchObject({ shell: false, windowsHide: true });
    expect(server.running).toBe(false);
  });

  it('elsewhere, starts the server in its own process group, to stop the group', () => {
    const launches: Launch[] = [];
    const spawn: SpawnFn = (command, args, options) => {
      launches.push({ command, args, options });
      return inertChild(7);
    };
    launchServer('llama-server', [], { env: {}, spawn, platform: 'linux' });
    launchServer('llama-server', [], { env: {}, spawn, platform: 'win32' });
    expect(launches[0]!.options).toMatchObject({ detached: true });
    expect(launches[1]!.options.detached).toBeFalsy();
  });

  it('stopping a server that already left does nothing', async () => {
    const child = inertChild(5);
    const server = launchServer('llama', [], { env: {}, spawn: () => child, platform: 'win32' });
    child.kill();
    await server.stop();
    expect(server.running).toBe(false);
  });
});
