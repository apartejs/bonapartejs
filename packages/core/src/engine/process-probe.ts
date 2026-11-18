/**
 * What the supervisor asks the system about a process it wrote down in an
 * earlier life — its command line, to know whether it is really ours (pids
 * get recycled) — and how to bring it down with its whole tree. Also the
 * engine's version. Everything goes through spawnHidden.
 */

import { readFile } from 'node:fs/promises';
import { withoutSecrets } from '../process/env.js';
import { spawnHidden, type SpawnFn } from '../process/spawn.js';

export interface ProcessProbe {
  /** The command line of a running process; null when there is none with this pid. */
  commandLine(pid: number): Promise<string | null>;
  /** Brings the process — on Windows with its tree — down. */
  kill(pid: number): Promise<void>;
}

interface Ran {
  code: number | null;
  stdout: string;
}

/** Runs a short command and collects what it prints; null when it could not run or took too long. */
export function runShort(command: string, args: readonly string[], timeoutMs: number, spawn?: SpawnFn): Promise<Ran | null> {
  return new Promise((resolve) => {
    let child;
    try {
      // A probe of a binary the person picked, tar unpacking a download: none of the app's secrets (audit 13.4).
      child = spawnHidden(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: withoutSecrets(process.env), ...(spawn ? { spawn } : {}) });
    } catch {
      resolve(null);
      return;
    }
    let stdout = '';
    let settled = false;
    const done = (value: Ran | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      done(null);
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    // An engine may print its version on either stream.
    child.stderr?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.on('error', () => done(null));
    // 'close', not 'exit': a process can be gone before all it printed is read.
    child.on('close', (code) => done({ code, stdout }));
  });
}

const PROBE_TIMEOUT_MS = 15_000;

export const defaultProcessProbe: ProcessProbe = {
  async commandLine(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    if (process.platform === 'win32') {
      const script =
        `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; ` + 'if ($p) { $p.CommandLine }';
      const ran = await runShort('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], PROBE_TIMEOUT_MS);
      const line = ran?.stdout.trim() ?? '';
      return line === '' ? null : line;
    }
    if (process.platform === 'linux') {
      try {
        const raw = await readFile(`/proc/${pid}/cmdline`, 'utf8');
        return raw === '' ? null : raw.split('\0').join(' ').trim();
      } catch {
        return null;
      }
    }
    const ran = await runShort('ps', ['-o', 'command=', '-p', String(pid)], PROBE_TIMEOUT_MS);
    const line = ran?.code === 0 ? ran.stdout.trim() : '';
    return line === '' ? null : line;
  },

  async kill(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return;
    if (process.platform === 'win32') {
      await runShort('taskkill', ['/pid', String(pid), '/T', '/F'], PROBE_TIMEOUT_MS);
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

/**
 * The engine's build, as `--version` gives it (`version: 7100 (abc1234)`, or
 * `b10217-ddd4ec142` for the unified CLI): its first line. 'unknown' when it
 * cannot say. The unified CLI takes `--version` without `serve`.
 */
export async function readBuildTag(command: string, args: readonly string[], spawn?: SpawnFn): Promise<string> {
  const ran = await runShort(command, args, 10_000, spawn);
  if (!ran) return 'unknown';
  const line = ran.stdout
    .split(/\r?\n/)
    .map((text) => text.trim())
    .find((text) => text.length > 0);
  return line ?? 'unknown';
}
