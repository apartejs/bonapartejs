/**
 * What the supervisor asks the operating system about a pid it wrote down in
 * an earlier life: is it still a llama (pids get recycled), and how to bring
 * it down with its whole tree.
 */

import { spawnSync } from 'node:child_process';

export interface ProcessProbe {
  /** Does the process still exist AND is it actually a llama-server? */
  isLlama(pid: number): boolean;
  /** Brings the process — and on Windows its tree — down. */
  kill(pid: number): void;
}

export const defaultProcessProbe: ProcessProbe = {
  isLlama(pid) {
    if (process.platform !== 'win32') {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    }
    const listed = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 5_000,
    });
    return /llama/i.test(listed.stdout ?? '');
  },
  kill(pid) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5_000,
      });
      return;
    }
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  },
};
