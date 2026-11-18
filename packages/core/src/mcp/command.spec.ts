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

  it('a program found on the PATH runs by its full path', () => {
    expect(resolveCommand('uvx', ['mcp-server-git'], { env, platform: 'win32', exists })).toEqual({
      command: 'C:\\Users\\me\\.local\\bin\\uvx.exe',
      args: ['mcp-server-git'],
    });
  });

  it('another .cmd or .bat would run through a shell: refused, the reason said', () => {
    expect(() => resolveCommand('server', [], { env, platform: 'win32', exists })).toThrow(/shell/);
    expect(() => resolveCommand('C:\\tools\\run.bat', [], { env, platform: 'win32', exists })).toThrow(/shell/);
  });

  it('a program not found is left as it is: its launch says it is missing', () => {
    expect(resolveCommand('docker', ['run'], { env, platform: 'win32', exists })).toEqual({ command: 'docker', args: ['run'] });
  });

  it('elsewhere than Windows, nothing changes', () => {
    expect(resolveCommand('npx', ['-y', 'x'], { env, platform: 'linux', exists })).toEqual({ command: 'npx', args: ['-y', 'x'] });
  });
});
