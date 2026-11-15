/**
 * Git, run as every process is: through `spawnHidden`, an argument array,
 * no shell, no window. Its output is read whole; a failure is its exit code.
 */

import { spawnHidden } from '../process/spawn.js';

export interface GitResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function git(args: readonly string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawnHidden('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: String(error) });
      return;
    }
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (error) => resolve({ code: null, stdout, stderr: stderr || String(error) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
