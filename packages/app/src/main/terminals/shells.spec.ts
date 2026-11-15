/**
 * The machine's shells: only those present, the person's own first on
 * Linux and macOS, Windows PowerShell first on Windows.
 */

import { describe, expect, it } from 'vitest';
import { findShells } from './shells.js';

describe('the shells of the machine', () => {
  it('on Windows: the ones installed, Windows PowerShell first, cmd from ComSpec', () => {
    const present = new Set(['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'C:\\Windows\\system32\\cmd.exe']);
    const shells = findShells('win32', { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', ComSpec: 'C:\\Windows\\system32\\cmd.exe' }, (path) => present.has(path));
    expect(shells.map((shell) => shell.id)).toEqual(['powershell', 'cmd']);
    expect(shells[0]).toMatchObject({ label: 'Windows PowerShell', args: ['-NoLogo'] });
  });

  it('elsewhere: the person’s own shell first, then the usual ones present, each once', () => {
    const present = new Set(['/bin/zsh', '/bin/bash', '/bin/sh']);
    const shells = findShells('linux', { SHELL: '/bin/zsh' }, (path) => present.has(path));
    expect(shells.map((shell) => shell.id)).toEqual(['zsh', 'bash', 'sh']);
    expect(shells[0]).toMatchObject({ file: '/bin/zsh', args: ['-i'] });
  });

  it('no shell present: none offered', () => {
    expect(findShells('linux', {}, () => false)).toEqual([]);
  });
});
