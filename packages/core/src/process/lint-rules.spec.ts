/**
 * Three invariants are held by lint, so that a slip fails the gate instead of
 * shipping: the core never imports electron; a process is launched through
 * `spawnHidden` and nowhere else; nobody ever writes `shell: true`.
 *
 * These tests run ESLint, with the repository's own configuration, on a few
 * lines of text placed at a path of our choosing.
 */

import { ESLint } from 'eslint';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

describe('the lint rules that hold the invariants', () => {
  let eslint: ESLint;

  beforeAll(() => {
    eslint = new ESLint({
      cwd: root,
      // The Nx boundary rule reads the project graph; these tests judge our own rules.
      overrideConfig: [{ rules: { '@nx/enforce-module-boundaries': 'off' } }],
    });
  });

  async function brokenRules(file: string, code: string): Promise<string[]> {
    const [result] = await eslint.lintText(code, { filePath: join(root, file) });
    return result!.messages.map((message) => message.ruleId ?? message.message);
  }

  const usesElectron = "import { app } from 'electron';\nexport const name = app.name;\n";
  const usesChildProcess = "import { spawn } from 'node:child_process';\nexport const launch = spawn;\n";
  const usesBareChildProcess = "import { spawn } from 'child_process';\nexport const launch = spawn;\n";

  it('refuses electron in the core', async () => {
    expect(await brokenRules('packages/core/src/x.ts', usesElectron)).toContain('no-restricted-imports');
    expect(await brokenRules('packages/core/src/engine/deep/x.ts', usesElectron)).toContain('no-restricted-imports');
  });

  it('refuses electron in the one core file that may import child_process', async () => {
    expect(await brokenRules('packages/core/src/process/spawn.ts', usesElectron)).toContain('no-restricted-imports');
  });

  it('lets the app import electron', async () => {
    expect(await brokenRules('packages/app/src/main/index.ts', usesElectron)).not.toContain('no-restricted-imports');
  });

  it('refuses child_process everywhere but in spawn.ts', async () => {
    expect(await brokenRules('packages/core/src/engine/x.ts', usesChildProcess)).toContain('no-restricted-imports');
    expect(await brokenRules('packages/core/src/engine/x.ts', usesBareChildProcess)).toContain('no-restricted-imports');
    expect(await brokenRules('packages/app/src/main/x.ts', usesChildProcess)).toContain('no-restricted-imports');
    expect(await brokenRules('plugins/terminal/src/node.ts', usesChildProcess)).toContain('no-restricted-imports');
    expect(await brokenRules('packages/core/src/process/spawn.ts', usesChildProcess)).not.toContain(
      'no-restricted-imports',
    );
  });

  it('refuses `shell: true` anywhere, spawn.ts included', async () => {
    const withShell = "export const options = { shell: true, cwd: '.' };\n";
    const quotedKey = "export const options = { 'shell': true };\n";
    const withoutShell = "export const options = { shell: false, cwd: '.' };\n";
    expect(await brokenRules('packages/core/src/x.ts', withShell)).toContain('no-restricted-syntax');
    expect(await brokenRules('packages/app/src/main/x.ts', quotedKey)).toContain('no-restricted-syntax');
    expect(await brokenRules('packages/core/src/process/spawn.ts', withShell)).toContain('no-restricted-syntax');
    expect(await brokenRules('packages/core/src/x.ts', withoutShell)).toEqual([]);
  });
}, 60_000);
