/**
 * « Always allow » remembers the exact command, or the whole program — never
 * its first word read out of a string: a command is a program and its
 * arguments, run without a shell. A shell, or a line that chains, pipes or
 * substitutes, is never remembered.
 */

import { describe, expect, it } from 'vitest';
import { alwaysRule, isRememberable, matchesRule, normalizeProgram, type AllowRule } from './rules.js';

describe('normalizeProgram', () => {
  it('compares programs without case, folder or Windows extension', () => {
    expect(normalizeProgram('PNPM')).toBe('pnpm');
    expect(normalizeProgram('pnpm.cmd')).toBe('pnpm');
    expect(normalizeProgram('C:\\Program Files\\Git\\bin\\git.exe')).toBe('git');
    expect(normalizeProgram('/usr/bin/node')).toBe('node');
  });
});

describe('isRememberable', () => {
  it('refuses a shell, whatever its spelling', () => {
    for (const program of ['cmd', 'CMD.EXE', 'powershell', 'pwsh', 'bash', 'sh', 'zsh', 'C:\\Windows\\System32\\cmd.exe']) {
      expect(isRememberable({ program, args: ['/c', 'dir'] })).toBe(false);
    }
  });

  it('refuses a line that chains, pipes or substitutes, wherever it stands', () => {
    for (const args of [['test', '&&', 'curl', 'x'], ['test|sh'], ['a;b'], ['`whoami`'], ['$(whoami)']]) {
      expect(isRememberable({ program: 'pnpm', args })).toBe(false);
    }
  });

  it('takes a plain program and its arguments', () => {
    expect(isRememberable({ program: 'pnpm', args: ['test', '--filter', '@aparte/bonaparte-core'] })).toBe(true);
  });
});

describe('alwaysRule', () => {
  it('remembers the exact command, or the whole program', () => {
    expect(alwaysRule('run_command', { program: 'pnpm.cmd', args: ['test'] }, 'command')).toEqual({
      tool: 'run_command',
      program: 'pnpm',
      args: ['test'],
    });
    expect(alwaysRule('run_command', { program: 'pnpm', args: ['test'] }, 'program')).toEqual({ tool: 'run_command', program: 'pnpm' });
  });

  it('refuses to remember what may not be', () => {
    expect(() => alwaysRule('run_command', { program: 'bash', args: ['-c', 'ls'] }, 'program')).toThrow(/cannot be remembered/);
    expect(() => alwaysRule('run_command', { program: 'pnpm', args: ['test', '&&', 'curl'] }, 'command')).toThrow(/cannot be remembered/);
  });
});

describe('matchesRule', () => {
  const exact: AllowRule = { tool: 'run_command', program: 'pnpm', args: ['test'] };
  const program: AllowRule = { tool: 'run_command', program: 'pnpm' };

  it('an exact rule answers that command only', () => {
    expect(matchesRule(exact, 'run_command', { program: 'PNPM.cmd', args: ['test'] })).toBe(true);
    expect(matchesRule(exact, 'run_command', { program: 'pnpm', args: ['test', '--watch'] })).toBe(false);
    expect(matchesRule(exact, 'run_command', { program: 'pnpm', args: ['testament'] })).toBe(false);
  });

  it('a program rule answers its arguments — never another program, never a chain', () => {
    expect(matchesRule(program, 'run_command', { program: 'pnpm', args: ['build'] })).toBe(true);
    expect(matchesRule(program, 'run_command', { program: 'npm', args: ['build'] })).toBe(false);
    expect(matchesRule(program, 'run_command', { program: 'pnpm', args: ['test', '&&', 'curl', 'evil'] })).toBe(false);
  });

  it('a rule answers its own tool only; a command rule never answers a call without its command', () => {
    expect(matchesRule(program, 'browser_act', { program: 'pnpm', args: [] })).toBe(false);
    expect(matchesRule(program, 'run_command', undefined)).toBe(false);
    expect(matchesRule({ tool: 'web_fetch' }, 'web_fetch', undefined)).toBe(true);
  });
});
