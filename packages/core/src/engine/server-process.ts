/**
 * The process of the managed llama-server: the one piece of the engine's life
 * cycle that touches the operating system's process table. It is launched
 * through spawnHidden, with an environment that carries its key and none of
 * the person's secrets, and it is stopped with its whole tree.
 */

import { spawnHidden, type SpawnedProcess, type SpawnFn } from '../process/spawn.js';

/** Names that hold a secret: an API key, a token, a password. */
const SECRET_NAME = /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH)(?:_|$)/i;

/**
 * The environment of the server: the parent's, without anything that looks
 * like a secret (the server needs none, and a crash report or a verbose log
 * could print it — security rule 10), plus its own key.
 */
export function serverEnvironment(base: Record<string, string | undefined>, key: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined || SECRET_NAME.test(name)) continue;
    env[name] = value;
  }
  env['LLAMA_API_KEY'] = key;
  return env;
}

export interface ServerProcess {
  readonly pid: number | undefined;
  readonly running: boolean;
  /** Resolves with the exit code once the process is gone (null: killed, or never started). */
  readonly exited: Promise<number | null>;
  /** The last lines the server wrote: what to show when it failed to start. */
  lastLines(): string;
  /** Brings the server down — on Windows with its whole tree — and resolves once it is gone. */
  stop(): Promise<void>;
}

export interface LaunchServerOptions {
  env: Record<string, string>;
  /** Every line the server writes on its error stream (llama.cpp logs there). */
  log?: (line: string) => void;
  /** Injected in tests: what spawnHidden launches with. */
  spawn?: SpawnFn;
  platform?: NodeJS.Platform;
}

const STOP_TIMEOUT_MS = 5_000;
const KEPT_LINES = 20;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms).unref?.());

export function launchServer(command: string, args: readonly string[], options: LaunchServerOptions): ServerProcess {
  const platform = options.platform ?? process.platform;
  const log = options.log ?? (() => undefined);
  const lines: string[] = [];
  let running = true;
  let resolveExit: (code: number | null) => void = () => undefined;
  const exited = new Promise<number | null>((resolve) => (resolveExit = resolve));
  const finish = (code: number | null): void => {
    if (!running) return;
    running = false;
    resolveExit(code);
  };

  let child: SpawnedProcess;
  try {
    child = spawnHidden(command, args, {
      env: options.env,
      stdio: ['ignore', 'ignore', 'pipe'],
      // Elsewhere than Windows the server leads its own process group, so
      // that the whole group can be stopped at once.
      ...(platform === 'win32' ? {} : { detached: true }),
      ...(options.spawn ? { spawn: options.spawn } : {}),
    });
  } catch (error) {
    log(`[llama-server] could not be launched: ${error instanceof Error ? error.message : String(error)}`);
    finish(null);
    return { pid: undefined, running: false, exited, lastLines: () => '', stop: async () => undefined };
  }

  child.on('exit', (code) => finish(code));
  child.on('error', (error) => {
    log(`[llama-server] ${error.message}`);
    finish(null);
  });
  let partial = '';
  child.stderr?.on('data', (chunk: Buffer | string) => {
    partial += chunk.toString();
    const complete = partial.split(/\r?\n/);
    partial = complete.pop() ?? '';
    for (const coloured of complete) {
      // llama.cpp colours its log even into a pipe: the words are kept, not the escapes.
      const line = coloured.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
      if (line.trim() === '') continue;
      lines.push(line);
      if (lines.length > KEPT_LINES) lines.shift();
      log(`[llama-server] ${line}`);
    }
  });

  const stop = async (): Promise<void> => {
    if (!running) return;
    const pid = child.pid;
    if (platform === 'win32' && pid !== undefined) {
      // The unified `llama` CLI is a launcher whose child is the real server:
      // killing the launcher alone would leave the model in video memory.
      try {
        spawnHidden('taskkill', ['/pid', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          ...(options.spawn ? { spawn: options.spawn } : {}),
        });
      } catch {
        child.kill();
      }
    } else {
      try {
        if (pid !== undefined) process.kill(-pid, 'SIGTERM');
        else child.kill();
      } catch {
        child.kill();
      }
    }
    await Promise.race([exited, delay(STOP_TIMEOUT_MS)]);
    if (running) {
      // Still there: the last resort.
      child.kill('SIGKILL');
      await Promise.race([exited, delay(STOP_TIMEOUT_MS)]);
    }
  };

  return {
    get pid() {
      return child.pid;
    },
    get running() {
      return running;
    },
    exited,
    lastLines: () => lines.join('\n'),
    stop,
  };
}
