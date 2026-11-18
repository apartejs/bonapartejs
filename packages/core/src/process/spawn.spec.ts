/**
 * Every child process of bonaparte goes through one function. Two guarantees
 * hold whatever the caller asks: no shell (so a file name or a script name can
 * never become a command), and no visible console window on Windows.
 */

import { describe, expect, it } from 'vitest';
import { spawnHidden, spawnWindowed, type SpawnFn } from './spawn.js';

function recorder() {
  const calls: { command: string; args: readonly string[]; options: Record<string, unknown> }[] = [];
  const spawn: SpawnFn = (command, args, options) => {
    calls.push({ command, args, options: options as Record<string, unknown> });
    return {} as ReturnType<SpawnFn>;
  };
  return { calls, spawn };
}

describe('spawnHidden', () => {
  it('hands the program and its arguments to spawn, without a shell and without a window', () => {
    const { calls, spawn } = recorder();
    spawnHidden('node', ['-e', '0'], { spawn });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe('node');
    expect(calls[0]!.args).toEqual(['-e', '0']);
    expect(calls[0]!.options).toMatchObject({ shell: false, windowsHide: true });
  });

  it('keeps both guarantees when the caller asks for the opposite', () => {
    const { calls, spawn } = recorder();
    // The type refuses these two options; a JavaScript caller or a cast can
    // still pass them. They are overridden, the rest is kept.
    const on = true;
    const asked = { shell: on, windowsHide: false, cwd: 'somewhere' } as object;
    spawnHidden('node', [], { ...asked, spawn });
    expect(calls[0]!.options).toMatchObject({ shell: false, windowsHide: true, cwd: 'somewhere' });
  });

  it('does not pass its own seam on to spawn', () => {
    const { calls, spawn } = recorder();
    spawnHidden('node', [], { spawn });
    expect(calls[0]!.options).not.toHaveProperty('spawn');
  });

  it('really launches a process, and its output comes back', async () => {
    const child = spawnHidden(process.execPath, ['-e', 'process.stdout.write("ok")'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    child.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    const code = await new Promise((resolve) => child.on('exit', resolve));
    expect(code).toBe(0);
    expect(output).toBe('ok');
  });
});

describe('spawnWindowed (task 13.3)', () => {
  it('launches a program with a window of its own: no shell, its window shown, detached from the command that launched it', () => {
    const { calls, spawn } = recorder();
    spawnWindowed('/opt/electron/electron', ['/opt/app'], { spawn, env: { A: '1' } });
    expect(calls[0]!.command).toBe('/opt/electron/electron');
    expect(calls[0]!.args).toEqual(['/opt/app']);
    expect(calls[0]!.options).toMatchObject({ shell: false, windowsHide: false, detached: true, stdio: 'ignore', env: { A: '1' } });
  });

  it('refuses a batch file or a console script: those are run by a shell, in a console', () => {
    const { calls, spawn } = recorder();
    for (const program of ['/x/electron.cmd', '/x/run.BAT', '/x/a.ps1']) {
      expect(() => spawnWindowed(program, [], { spawn })).toThrow(/window/);
    }
    expect(calls).toHaveLength(0);
  });
});
