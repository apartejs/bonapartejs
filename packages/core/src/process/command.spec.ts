import { win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCommand } from './command.js';

const NODE_DIR = 'C:\\Program Files\\nodejs';
const env = { PATH: `C:\\Windows\\system32;${NODE_DIR};C:\\Users\\me\\.local\\bin`, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
const files = new Set(
  [
    win32.join(NODE_DIR, 'node.exe'),
    win32.join(NODE_DIR, 'npx.cmd'),
    win32.join(NODE_DIR, 'npm.cmd'),
    win32.join(NODE_DIR, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    win32.join(NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    'C:\\Users\\me\\.local\\bin\\uvx.exe',
    'C:\\Users\\me\\.local\\bin\\server.cmd',
  ].map((path) => path.toLowerCase()),
);
const exists = (path: string): boolean => files.has(path.toLowerCase());

describe('a stdio server’s command, on Windows (task 10.5)', () => {
  it('npx is a .cmd: it runs as node and npm’s own script beside it — never through a shell', () => {
    expect(resolveCommand('npx', ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\dev'], { env, platform: 'win32', exists })).toEqual({
      command: win32.join(NODE_DIR, 'node.exe'),
      args: [win32.join(NODE_DIR, 'node_modules', 'npm', 'bin', 'npx-cli.js'), '-y', '@modelcontextprotocol/server-filesystem', 'C:\\dev'],
    });
    expect(resolveCommand('npm', ['exec', 'x'], { env, platform: 'win32', exists }).args[0]).toBe(win32.join(NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  });

  it('a relative entry of the PATH is not the PATH: it would be the folder the server runs in (audit 13.4)', () => {
    const planted = new Set([...files, '.\\uvx.exe', 'tools\\uvx.exe']);
    const resolved = resolveCommand('uvx', [], { env: { ...env, PATH: `.;tools;${env.PATH}` }, platform: 'win32', exists: (path) => planted.has(path.toLowerCase()) });
    expect(resolved.command).toBe('C:\\Users\\me\\.local\\bin\\uvx.exe');
  });

  it('a program found on the PATH runs by its full path', () => {
    expect(resolveCommand('uvx', ['mcp-server-git'], { env, platform: 'win32', exists })).toEqual({
      command: 'C:\\Users\\me\\.local\\bin\\uvx.exe',
      args: ['mcp-server-git'],
    });
  });

  it('a .cmd that npm wrote for a global package runs as node and the script it names — pnpm, say', () => {
    const npmDir = win32.join('C:\\Users', 'me', 'AppData', 'Roaming', 'npm');
    const shim = win32.join(npmDir, 'pnpm.cmd');
    const script = win32.join(npmDir, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
    const more = new Set([...files, shim.toLowerCase(), script.toLowerCase()]);
    // What npm's cmd-shim writes for a global package (its last line).
    const text = ['@ECHO off', 'SETLOCAL', `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%${win32.sep}node_modules${win32.sep}pnpm${win32.sep}bin${win32.sep}pnpm.cjs" %*`].join('\r\n');
    expect(
      resolveCommand('pnpm', ['run', 'dev'], {
        env: { ...env, PATH: `${env.PATH};${npmDir}` },
        platform: 'win32',
        exists: (path) => more.has(path.toLowerCase()),
        read: (path) => (path.toLowerCase() === shim.toLowerCase() ? text : null),
      }),
    ).toEqual({ command: win32.join(NODE_DIR, 'node.exe'), args: [script, 'run', 'dev'] });
  });

  it('another .cmd or .bat would run through a shell: refused, the reason said', () => {
    expect(() => resolveCommand('server', [], { env, platform: 'win32', exists })).toThrow(/shell/);
    expect(() => resolveCommand('C:\\tools\\run.bat', [], { env, platform: 'win32', exists })).toThrow(/shell/);
  });
});

describe('a bare .cmd is looked for on the PATH only (review of 2026-11-21)', () => {
  it('never read from the app\'s own folder, then run against the project\'s', () => {
    const here = new Map([['tool.cmd', '@node "%~dp0\\payload.js" %*'], [win32.join(NODE_DIR, 'node.exe').toLowerCase(), '']]);
    const machine = {
      env: { PATH: `C:\\Windows\\system32;${NODE_DIR}`, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
      platform: 'win32' as const,
      exists: (file: string) => here.has(file.toLowerCase()),
      read: (file: string) => here.get(file.toLowerCase()) ?? null,
    };
    expect(() => resolveCommand('tool.cmd', ['a'], { ...machine, cwd: 'C:\\dev\\app', notFound: 'refuse' })).toThrow(/not found where it is looked for/);
  });
});

describe('the npm family on Windows, for run_command too (audit 2026-11-21, D1)', () => {
  const npmDir = 'C:\\Users\\me\\AppData\\Roaming\\npm';
  const project = 'C:\\dev\\app';
  /** A machine of shims: each path its text (a script's is empty). */
  function machine(tree: Record<string, string>, path = `C:\\Windows\\system32;${NODE_DIR};${npmDir}`) {
    const all = new Map(Object.entries(tree).map(([file, text]) => [file.toLowerCase(), text]));
    return {
      env: { PATH: path, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
      platform: 'win32' as const,
      exists: (file: string) => all.has(file.toLowerCase()),
      read: (file: string) => all.get(file.toLowerCase()) ?? null,
    };
  }
  const node = win32.join(NODE_DIR, 'node.exe');
  // npm's cmd-shim, as it writes a global package's shim (pnpm, yarn 1).
  const cmdShim = (target: string) =>
    [
      '@ECHO off',
      'GOTO start',
      ':find_dp0',
      'SET dp0=%~dp0',
      'EXIT /b',
      ':start',
      'SETLOCAL',
      'CALL :find_dp0',
      '',
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ') ELSE (',
      '  SET "_prog=node"',
      '  SET PATHEXT=%PATHEXT:;.JS;=;%',
      ')',
      '',
      `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${target}" %*`,
    ].join('\r\n');
  // The older form: corepack's shims, pnpm's node_modules\.bin.
  const dp0Shim = (target: string) =>
    [
      '@SETLOCAL',
      '@IF EXIST "%~dp0\\node.exe" (',
      `  "%~dp0\\node.exe"  "%~dp0\\${target}" %*`,
      ') ELSE (',
      '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
      `  node  "%~dp0\\${target}" %*`,
      ')',
    ].join('\r\n');

  it('pnpm.cmd npm installed runs as node and pnpm.cjs, with node from the PATH when none is beside it', () => {
    const shim = win32.join(npmDir, 'pnpm.cmd');
    const script = win32.join(npmDir, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
    const seen = machine({ [node]: '', [shim]: cmdShim('node_modules\\pnpm\\bin\\pnpm.cjs'), [script]: '' });
    expect(resolveCommand('pnpm', ['test'], seen)).toEqual({ command: node, args: [script, 'test'] });
  });

  it('yarn 1 installed by npm, and the corepack shims (pnpm, yarn) Node carries, run through node too', () => {
    const yarn = win32.join(npmDir, 'yarn.cmd');
    const yarnJs = win32.join(npmDir, 'node_modules', 'yarn', 'bin', 'yarn.js');
    expect(resolveCommand('yarn', [], machine({ [node]: '', [yarn]: cmdShim('node_modules\\yarn\\bin\\yarn.js'), [yarnJs]: '' }))).toEqual({
      command: node,
      args: [yarnJs],
    });
    // `corepack enable` puts pnpm.cmd beside node.exe.
    const corepackPnpm = win32.join(NODE_DIR, 'pnpm.cmd');
    const corepackJs = win32.join(NODE_DIR, 'node_modules', 'corepack', 'dist', 'pnpm.js');
    expect(
      resolveCommand('pnpm', ['install'], machine({ [node]: '', [corepackPnpm]: dp0Shim('node_modules\\corepack\\dist\\pnpm.js'), [corepackJs]: '' })),
    ).toEqual({ command: node, args: [corepackJs, 'install'] });
  });

  it('npm and npx with no node beside them (a global npm in AppData) run with the node of the PATH', () => {
    const npm = win32.join(npmDir, 'npm.cmd');
    const cli = win32.join(npmDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const seen = machine({ [node]: '', [npm]: '@ECHO OFF\r\nSET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"', [cli]: '' }, `${npmDir};${NODE_DIR}`);
    expect(resolveCommand('npm', ['run', 'build'], seen)).toEqual({ command: node, args: [cli, 'run', 'build'] });
  });

  it('a tool of node_modules\\.bin named by its path, relative to the folder the command runs in', () => {
    const bin = win32.join(project, 'node_modules', '.bin');
    const tsc = win32.join(project, 'node_modules', 'typescript', 'bin', 'tsc');
    const seen = machine({ [node]: '', [win32.join(bin, 'tsc.CMD')]: dp0Shim('..\\typescript\\bin\\tsc'), [tsc]: '' });
    expect(resolveCommand('node_modules\\.bin\\tsc', ['--noEmit'], { ...seen, cwd: project })).toEqual({ command: node, args: [tsc, '--noEmit'] });
    expect(resolveCommand('node_modules/.bin/tsc.cmd', [], { ...seen, cwd: project })).toEqual({ command: node, args: [tsc] });
  });

  it('a batch file that is no shim of node stays refused, saying why and what to do', () => {
    const bat = 'C:\\tools\\build.bat';
    const seen = machine({ [node]: '', [bat]: '@echo off\r\ncl /O2 main.c %*' });
    expect(() => resolveCommand(bat, [], seen)).toThrow(/shell.*(node|\.exe)/s);
    // cmd-shim's shim of a shell script: its `_prog` is sh, not node.
    const sh = win32.join(npmDir, 'tool.cmd');
    const shText = cmdShim('node_modules\\tool\\bin\\tool').replace(/node\.exe/g, 'sh.exe').replace('"_prog=node"', '"_prog=sh"');
    expect(() => resolveCommand('tool', [], machine({ [node]: '', [sh]: shText, [win32.join(npmDir, 'node_modules', 'tool', 'bin', 'tool')]: '' }))).toThrow(/shell/);
    // A shim whose script is not there is not run either.
    const shim = win32.join(npmDir, 'pnpm.cmd');
    expect(() => resolveCommand('pnpm', [], machine({ [node]: '', [shim]: cmdShim('node_modules\\pnpm\\bin\\pnpm.cjs') }))).toThrow(/shell/);
  });

  it('a program the PATH does not hold is said so, when asked: never a launch of a path that does not exist', () => {
    const seen = machine({ [node]: '' });
    expect(() => resolveCommand('pnpm', ['test'], { ...seen, notFound: 'refuse' })).toThrow(/pnpm was not found on the PATH/);
    expect(resolveCommand('pnpm', ['test'], seen)).toEqual({ command: 'pnpm', args: ['test'] });
  });

  it('a program not found is left as it is: its launch says it is missing', () => {
    expect(resolveCommand('docker', ['run'], { env, platform: 'win32', exists })).toEqual({ command: 'docker', args: ['run'] });
  });

  it('elsewhere than Windows, nothing changes', () => {
    expect(resolveCommand('npx', ['-y', 'x'], { env, platform: 'linux', exists })).toEqual({ command: 'npx', args: ['-y', 'x'] });
  });
});
