/**
 * « Always allow » remembers what the card showed and nothing more (audit
 * 2026-11-21, D3; security rule 2): the exact command — never its first word,
 * never its program alone —, a write's folder, a page's site, or a tool whose
 * calls name none of those. A shell, or a line that chains, pipes or
 * substitutes, is never remembered; a rule read from disk that could not have
 * been remembered answers nothing.
 */

import { describe, expect, it } from 'vitest';
import { isRememberable, isValidRule, matchesRule, normalizeProgram, originOf, pathPattern, ruleFor, type AllowRule, type CallSubject } from './rules.js';

const command = (program: string, args: string[]): CallSubject => ({ kind: 'command', command: { program, args } });
const path = (relative: string | null): CallSubject => ({ kind: 'path', relative });
const site = (origin: string | null): CallSubject => ({ kind: 'origin', origin });

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

describe('ruleFor: what the card offers to remember', () => {
  it('a command: exactly that program and those arguments', () => {
    expect(ruleFor('run_command', command('pnpm.cmd', ['test']))).toEqual({ tool: 'run_command', program: 'pnpm', args: ['test'] });
    expect(ruleFor('run_command', command('git', []))).toEqual({ tool: 'run_command', program: 'git', args: [] });
  });

  it('never a shell, never a chain — and says which', () => {
    expect(ruleFor('run_command', command('bash', ['-c', 'ls']))).toEqual({ never: 'shell' });
    expect(ruleFor('run_command', command('powershell', ['-Command', 'Get-ChildItem']))).toEqual({ never: 'shell' });
    expect(ruleFor('run_command', command('pnpm', ['test', '&&', 'curl']))).toEqual({ never: 'chain' });
  });

  it('a write: its folder, or the file itself at the top of the perimeter; nothing outside it', () => {
    expect(pathPattern('src/components/Button.tsx')).toBe('src/components/**');
    expect(ruleFor('edit_file', path('src/format.ts'))).toEqual({ tool: 'edit_file', path: 'src/**' });
    expect(ruleFor('edit_file', path('notes.txt'))).toEqual({ tool: 'edit_file', path: 'notes.txt' });
    expect(ruleFor('edit_file', path(null))).toEqual({ never: 'outside' });
  });

  it('a page: its site — localhost with its port; nothing for a page not known', () => {
    expect(originOf('http://localhost:5173/app?x=1')).toBe('http://localhost:5173');
    expect(originOf('https://Example.com/a')).toBe('https://example.com');
    expect(originOf('file:///C:/a.html')).toBeNull();
    expect(originOf('not a url')).toBeNull();
    expect(ruleFor('browser_act', site('http://localhost:5173'))).toEqual({ tool: 'browser_act', origin: 'http://localhost:5173' });
    expect(ruleFor('browser_act', site(null))).toEqual({ never: 'unknown' });
  });

  it('a tool whose calls name nothing: the tool', () => {
    expect(ruleFor('mcp__files__read_text_file', { kind: 'none' })).toEqual({ tool: 'mcp__files__read_text_file' });
  });
});

describe('isValidRule: what a rule read from disk must be', () => {
  it('a program without its exact arguments is its first word: never valid (security rule 2)', () => {
    expect(isValidRule({ tool: 'run_command', program: 'pnpm' })).toBe(false);
    expect(isValidRule({ tool: 'run_command', program: 'pnpm', args: ['test'] })).toBe(true);
    expect(isValidRule({ tool: 'run_command', program: 'PNPM', args: ['test'] })).toBe(false);
    expect(isValidRule({ tool: 'run_command', program: 'bash', args: ['-c', 'ls'] })).toBe(false);
  });

  it('a path climbs nowhere and names no drive; a site is an origin; one subject at most', () => {
    for (const bad of ['../x', '/etc/passwd', 'C:/Windows/x', 'src\\a.ts', 'src/*.ts', '**', 'a/**/b', 'a//b', './a']) {
      expect(isValidRule({ tool: 'edit_file', path: bad })).toBe(false);
    }
    expect(isValidRule({ tool: 'edit_file', path: 'src/**' })).toBe(true);
    expect(isValidRule({ tool: 'browser_act', origin: 'https://example.com/' })).toBe(false);
    expect(isValidRule({ tool: 'browser_act', origin: 'https://example.com' })).toBe(true);
    expect(isValidRule({ tool: 'browser_act', origin: 'https://example.com', path: 'a' })).toBe(false);
    expect(isValidRule({ tool: 'web_fetch', args: ['x'] })).toBe(false);
  });
});

describe('matchesRule', () => {
  const exact: AllowRule = { tool: 'run_command', program: 'pnpm', args: ['test'] };

  it('an exact rule answers that command only — never another argument, never a chain', () => {
    expect(matchesRule(exact, 'run_command', command('PNPM.cmd', ['test']))).toBe(true);
    expect(matchesRule(exact, 'run_command', command('pnpm', ['test', '--watch']))).toBe(false);
    expect(matchesRule(exact, 'run_command', command('pnpm', ['testament']))).toBe(false);
    expect(matchesRule(exact, 'run_command', command('npm', ['test']))).toBe(false);
    expect(matchesRule({ tool: 'run_command', program: 'git', args: ['status'] }, 'run_command', command('git', ['push', '--force']))).toBe(false);
  });

  it('a forged program-wide rule answers nothing', () => {
    expect(matchesRule({ tool: 'run_command', program: 'pnpm' }, 'run_command', command('pnpm', ['build']))).toBe(false);
  });

  it('a folder answers the files under it, a file itself only', () => {
    const folder: AllowRule = { tool: 'edit_file', path: 'src/**' };
    expect(matchesRule(folder, 'edit_file', path('src/a.ts'))).toBe(true);
    expect(matchesRule(folder, 'edit_file', path('src/deep/b.ts'))).toBe(true);
    expect(matchesRule(folder, 'edit_file', path('srcx/a.ts'))).toBe(false);
    expect(matchesRule(folder, 'edit_file', path('src'))).toBe(false);
    expect(matchesRule(folder, 'edit_file', path(null))).toBe(false);
    expect(matchesRule(folder, 'write_file', path('src/a.ts'))).toBe(false);
    expect(matchesRule({ tool: 'edit_file', path: 'notes.txt' }, 'edit_file', path('notes.txt'))).toBe(true);
    expect(matchesRule({ tool: 'edit_file', path: 'notes.txt' }, 'edit_file', path('notes.txt.bak'))).toBe(false);
  });

  it('a site answers its own origin only — another port, scheme or host is another site', () => {
    const local: AllowRule = { tool: 'browser_act', origin: 'http://localhost:5173' };
    expect(matchesRule(local, 'browser_act', site('http://localhost:5173'))).toBe(true);
    expect(matchesRule(local, 'browser_act', site('http://localhost:3000'))).toBe(false);
    expect(matchesRule(local, 'browser_act', site('https://localhost:5173'))).toBe(false);
    expect(matchesRule(local, 'browser_act', site(null))).toBe(false);
    expect(matchesRule(local, 'browser_open', site('http://localhost:5173'))).toBe(false);
  });

  it('a tool-wide rule answers only the calls that name nothing', () => {
    expect(matchesRule({ tool: 'web_search' }, 'web_search', { kind: 'none' })).toBe(true);
    expect(matchesRule({ tool: 'run_command' }, 'run_command', command('pnpm', ['test']))).toBe(false);
    expect(matchesRule({ tool: 'edit_file' }, 'edit_file', path('src/a.ts'))).toBe(false);
    expect(matchesRule({ tool: 'browser_act' }, 'browser_act', site('https://example.com'))).toBe(false);
  });
});
