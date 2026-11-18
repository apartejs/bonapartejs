/**
 * Every child process of bonaparte goes through one function. Two guarantees
 * hold whatever the caller asks: no shell (so a file name or a script name can
 * never become a command), and no visible console window on Windows.
 */

import { describe, expect, it } from 'vitest';
import { isProgramFile, spawnHidden, spawnWindowed, type SpawnFn } from './spawn.js';

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
    spawnHidden('node', ['-e', '0'], { spawn, platform: 'linux' });
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

  it('on Windows, a bare name is the program found on the PATH — never one the folder it runs in holds (audit 13.4)', () => {
    const { calls, spawn } = recorder();
    const files = new Set(['C:\\proj\\git.exe', 'C:\\Git\\cmd\\git.exe']);
    spawnHidden('git', ['status'], { spawn, cwd: 'C:\\proj', env: { Path: 'C:\\Git\\cmd;C:\\Windows' }, platform: 'win32', exists: (path) => files.has(path) });
    expect(calls[0]!.command).toBe('C:\\Git\\cmd\\git.exe');
    expect(calls[0]!.options).toMatchObject({ cwd: 'C:\\proj' });
    expect(calls[0]!.options).not.toHaveProperty('platform');
    expect(calls[0]!.options).not.toHaveProperty('exists');
  });

  it('on Windows, a bare name the PATH does not hold is launched from nowhere: it fails, never found in its folder', () => {
    const { calls, spawn } = recorder();
    spawnHidden('git', ['status'], { spawn, cwd: 'C:\\proj', env: { PATH: 'C:\\Windows' }, platform: 'win32', exists: (path) => path === 'C:\\proj\\git.exe' });
    expect(calls[0]!.command).toMatch(/bonaparte-not-on-path\\git\.exe$/);
    expect(calls[0]!.options).toMatchObject({ cwd: 'C:\\proj' });
  });

  it('on Windows, only the PATH’s full entries count — a relative one is the folder it runs in again; quotes are Windows’ own', () => {
    const { calls, spawn } = recorder();
    const files = new Set(['.\\git.exe', 'bin\\git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe']);
    spawnHidden('git', [], { spawn, cwd: 'C:\\proj', env: { PATH: '.;bin;C:relative;"C:\\Program Files\\Git\\cmd"' }, platform: 'win32', exists: (path) => files.has(path) });
    expect(calls[0]!.command).toBe('C:\\Program Files\\Git\\cmd\\git.exe');
  });

  it('on Windows, a name with a dot is also tried with .exe, as Windows completes it', () => {
    const { calls, spawn } = recorder();
    const files = new Set(['C:\\Apps\\python3.12.exe']);
    spawnHidden('python3.12', ['x.py'], { spawn, env: { PATH: 'C:\\Apps' }, platform: 'win32', exists: (path) => files.has(path) });
    expect(calls[0]!.command).toBe('C:\\Apps\\python3.12.exe');
  });

  it('leaves a path as it is, and a bare name elsewhere than on Windows', () => {
    const { calls, spawn } = recorder();
    spawnHidden('C:\\tools\\llama-server.exe', [], { spawn, platform: 'win32', exists: () => true });
    spawnHidden('git', [], { spawn, cwd: '/proj', platform: 'linux', exists: () => true });
    expect(calls.map((call) => call.command)).toEqual(['C:\\tools\\llama-server.exe', 'git']);
    expect(calls[1]!.options).toMatchObject({ cwd: '/proj' });
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

describe('what counts as a program on the PATH (review of phase 13)', () => {
  it('a file, or a link Windows resolves itself (an app execution alias), never a folder', async () => {
    const { mkdtemp, mkdir: makeDir, writeFile: write, symlink: link, rm: remove } = await import('node:fs/promises');
    const { tmpdir: temp } = await import('node:os');
    const { join: joinPath } = await import('node:path');
    const dir = await mkdtemp(joinPath(temp(), 'bp-prog-'));
    try {
      await write(joinPath(dir, 'tool.exe'), 'x');
      await makeDir(joinPath(dir, 'folder.exe'));
      // An alias is a link whose target the file system cannot open: it is still a program for Windows.
      await link(joinPath(dir, 'nowhere.exe'), joinPath(dir, 'alias.exe'), 'file').catch(() => undefined);
      expect(isProgramFile(joinPath(dir, 'tool.exe'))).toBe(true);
      expect(isProgramFile(joinPath(dir, 'folder.exe'))).toBe(false);
      expect(isProgramFile(joinPath(dir, 'missing.exe'))).toBe(false);
      const { lstatSync } = await import('node:fs');
      const made = (() => {
        try {
          return lstatSync(joinPath(dir, 'alias.exe')).isSymbolicLink();
        } catch {
          return false;
        }
      })();
      if (made) expect(isProgramFile(joinPath(dir, 'alias.exe'))).toBe(true);
    } finally {
      await remove(dir, { recursive: true, force: true });
    }
  });
});
