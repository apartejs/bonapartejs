import { describe, expect, it } from 'vitest';
import { PermissionEngine, type PlayMode } from './engine.js';

const read = { tool: 'read_file', effect: 'read' as const };
const write = { tool: 'write_file', effect: 'write' as const };
const exec = { tool: 'run_shell', effect: 'execute' as const, command: 'pnpm test' };

function engine(mode: PlayMode): PermissionEngine {
  return new PermissionEngine(mode);
}

describe('PermissionEngine — mode × effect matrix', () => {
  it.each([
    ['lecture', 'allow', 'deny', 'deny'],
    ['repetition', 'allow', 'ask', 'ask'],
    ['plume', 'allow', 'allow', 'ask'],
    ['impro', 'allow', 'allow', 'allow'],
  ] as const)('%s: read=%s, write=%s, execute=%s', (mode, r, w, e) => {
    const perm = engine(mode);
    expect(perm.evaluate(read)).toBe(r);
    expect(perm.evaluate(write)).toBe(w);
    expect(perm.evaluate(exec)).toBe(e);
  });

  it('the default mode is Rehearsal', () => {
    expect(new PermissionEngine().getMode()).toBe('repetition');
  });

  it('setMode changes the arbitration immediately', () => {
    const perm = engine('repetition');
    expect(perm.evaluate(write)).toBe('ask');
    perm.setMode('plume');
    expect(perm.evaluate(write)).toBe('allow');
  });
});

describe('PermissionEngine — remembered rules', () => {
  it('a rule turns an "ask" into an "allow"', () => {
    const perm = engine('repetition');
    expect(perm.evaluate(write)).toBe('ask');
    perm.remember({ tool: 'write_file' });
    expect(perm.evaluate(write)).toBe('allow');
  });

  it('a rule NEVER lifts a denial coming from the mode', () => {
    const perm = engine('lecture');
    perm.remember({ tool: 'write_file' });
    perm.remember({ tool: 'run_shell', commandPrefix: 'pnpm' });
    expect(perm.evaluate(write)).toBe('deny');
    expect(perm.evaluate(exec)).toBe('deny');
  });

  it('a rule only applies to its own tool', () => {
    const perm = engine('repetition');
    perm.remember({ tool: 'write_file' });
    expect(perm.evaluate(exec)).toBe('ask');
  });

  it('prefix rule: allows the command that starts with the prefix', () => {
    const perm = engine('repetition');
    perm.remember({ tool: 'run_shell', commandPrefix: 'pnpm test' });
    expect(perm.evaluate(exec)).toBe('allow');
  });

  it('prefix rule: a different command is still left asking', () => {
    const perm = engine('repetition');
    perm.remember({ tool: 'run_shell', commandPrefix: 'pnpm test' });
    expect(
      perm.evaluate({ ...exec, command: 'rm -rf /' }),
    ).toBe('ask');
  });

  it('the prefix applies at word boundaries (no false positive)', () => {
    const perm = engine('repetition');
    perm.remember({ tool: 'run_shell', commandPrefix: 'pnpm test' });
    expect(perm.evaluate({ ...exec, command: 'pnpm testament-destructif' })).toBe(
      'ask',
    );
  });

  it('a rule with no prefix allows every command of the tool', () => {
    const perm = engine('repetition');
    perm.remember({ tool: 'run_shell' });
    expect(perm.evaluate({ ...exec, command: 'nimporte quoi' })).toBe('allow');
  });

  it('remember is idempotent', () => {
    const perm = engine('repetition');
    perm.remember({ tool: 'write_file' });
    perm.remember({ tool: 'write_file' });
    expect(perm.listRules()).toHaveLength(1);
  });

  it('forget removes the rule and restores the ask', () => {
    const perm = engine('repetition');
    perm.remember({ tool: 'write_file' });
    perm.forget({ tool: 'write_file' });
    expect(perm.listRules()).toEqual([]);
    expect(perm.evaluate(write)).toBe('ask');
  });

  it('rules provided at construction time apply', () => {
    const perm = new PermissionEngine('repetition', [{ tool: 'write_file' }]);
    expect(perm.evaluate(write)).toBe('allow');
  });

  it('listRules does not let internal state be mutated', () => {
    const perm = engine('repetition');
    perm.remember({ tool: 'write_file' });
    perm.listRules().push({ tool: 'run_shell' });
    expect(perm.listRules()).toHaveLength(1);
  });
});
