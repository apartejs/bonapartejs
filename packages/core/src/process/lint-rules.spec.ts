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

  it('refuses a built-in plugin the machine: it reaches files, network and processes through its context', async () => {
    const reaching = [
      "import { readFile } from 'node:fs/promises';\nexport const read = readFile;\n",
      "import { readFileSync } from 'fs';\nexport const read = readFileSync;\n",
      "import { connect } from 'node:net';\nexport const dial = connect;\n",
      "import { request } from 'node:http';\nexport const ask = request;\n",
      "import { request } from 'https';\nexport const ask = request;\n",
      "import { spawn } from 'node-pty';\nexport const open = spawn;\n",
    ];
    for (const code of reaching) {
      expect(await brokenRules('plugins/terminal/src/node.ts', code), code).toContain('no-restricted-imports');
    }
    // Nor by a module loaded later, which no import line names.
    for (const code of ["export const load = () => import('node:fs');\n", "export const kids = require('child_process');\n"]) {
      expect(await brokenRules('plugins/terminal/src/node.ts', code), code).toContain('no-restricted-syntax');
    }
    // Its own pure helpers are fine, and so is the rest of the repository.
    expect(await brokenRules('plugins/terminal/src/node.ts', "import { join } from 'node:path';\nexport const at = join;\n")).toEqual([]);
    expect(await brokenRules('packages/core/src/x.ts', reaching[0]!)).toEqual([]);
  });
}, 60_000);
