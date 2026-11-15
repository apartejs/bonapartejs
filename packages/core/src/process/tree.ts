/**
 * A process started for someone else — a plugin — and stopped with
 * everything it started in turn. On Windows the tree is `taskkill /T`; on
 * the other systems the process leads its own group, and the group is
 * signalled.
 */

import { spawnHidden, type SpawnedProcess, type SpawnFn, type SpawnHiddenOptions } from './spawn.js';

const STOP_TIMEOUT_MS = 3_000;

/** Hidden, with an argument array, and at the head of its own group where groups exist. */
export function spawnTree(
  command: string,
  args: readonly string[],
  options: SpawnHiddenOptions & { platform?: NodeJS.Platform } = {},
): SpawnedProcess {
  const { platform = process.platform, ...rest } = options;
  return spawnHidden(command, args, { ...rest, ...(platform === 'win32' ? {} : { detached: true }) });
}

const ended = (child: SpawnedProcess): boolean => child.exitCode !== null || child.signalCode !== null;

function exited(child: SpawnedProcess, ms: number): Promise<boolean> {
  if (ended(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(ended(child)), ms);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Stops the process and its children; resolves once it has ended, or after the last resort. */
export async function stopProcessTree(
  child: SpawnedProcess,
  options: { platform?: NodeJS.Platform; spawn?: SpawnFn; timeoutMs?: number } = {},
): Promise<void> {
  if (ended(child)) return;
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.timeoutMs ?? STOP_TIMEOUT_MS;
  const pid = child.pid;
  if (pid === undefined) {
    child.kill();
    await exited(child, timeoutMs);
    return;
  }
  if (platform === 'win32') {
    try {
      const killer = spawnHidden('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        ...(options.spawn ? { spawn: options.spawn } : {}),
      });
      killer.on('error', () => child.kill());
    } catch {
      child.kill();
    }
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
  if (await exited(child, timeoutMs)) return;
  // Still there: the last resort.
  try {
    if (platform === 'win32') child.kill('SIGKILL');
    else process.kill(-pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
  await exited(child, timeoutMs);
}
