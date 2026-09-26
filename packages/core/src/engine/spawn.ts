/**
 * The real spawn of the managed server — the only piece of the engine's life
 * cycle that touches the operating system's process table. Everything above
 * it takes a `SpawnFn` and is tested with a fake one.
 */

import { spawn, spawnSync } from 'node:child_process';
import type { ProcessHandle, SpawnFn } from '../backend/llamacpp/llamacpp-backend.js';

export function createServerSpawner(log: (line: string) => void): SpawnFn {
  return (binPath, args, env): ProcessHandle => {
    const child = spawn(binPath, args, {
      ...(env ? { env: { ...process.env, ...env } } : {}),
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      // POSIX: the server becomes the leader of its own process group, so we
      // can bring down the whole tree at once (see kill).
      ...(process.platform === 'win32' ? {} : { detached: true }),
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      log(`[llama-server] ${chunk.toString('utf8').trimEnd()}`);
    });
    return {
      ...(child.pid !== undefined ? { pid: child.pid } : {}),
      onExit: (cb) => child.on('exit', (code) => cb(code)),
      kill: () => {
        // Windows: the unified `llama` CLI is a launcher that spawns the real
        // server as a child — child.kill() would only kill the launcher and
        // leave the model loaded in VRAM. taskkill /T brings down the tree.
        //
        // Deliberately SYNCHRONOUS: at shutdown an asynchronous taskkill has
        // no time to start before Electron quits, and the server survives the
        // app (observed: an orphaned 24 GB llama-server). Blocking ~50 ms at
        // shutdown is the price of certainty.
        if (process.platform === 'win32' && child.pid) {
          try {
            spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              timeout: 5_000,
            });
          } catch {
            child.kill(); // last resort
          }
        } else {
          // POSIX: kill the process group, not just the launcher.
          try {
            if (child.pid) process.kill(-child.pid, 'SIGTERM');
            else child.kill();
          } catch {
            child.kill();
          }
        }
      },
    };
  };
}
