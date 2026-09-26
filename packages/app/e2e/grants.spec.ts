/**
 * What "always allow" granted is listed in the settings hub, per project,
 * and can be taken back (P1.8). The grants live on disk: a restart keeps
 * them, a revoke removes them from the file.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let dataDir: string;

test.beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-grants-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({ backend: { mode: 'managed', binPath: 'llama' }, locale: 'en' }),
  );
  await writeFile(
    join(dataDir, 'projects.json'),
    JSON.stringify({
      version: 1,
      projects: [{ id: 'proj-a', name: 'webshop', roots: [], createdAt: 'x', updatedAt: 'x' }],
    }),
  );
  await writeFile(
    join(dataDir, 'config', 'grants.json'),
    JSON.stringify({
      version: 1,
      projects: {
        'proj-a': [
          { tool: 'run_shell', commandPrefix: 'pnpm' },
          { tool: 'run_shell', exactCommand: 'git status' },
        ],
        '': [{ tool: 'edit_file' }],
      },
    }),
  );

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || value === undefined) continue;
    env[key] = value;
  }
  env['BONAPARTE_DATA_DIR'] = dataDir;
  env['BONAPARTE_E2E'] = '1';
  app = await electron.launch({
    args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')],
    env,
  });
});

test.afterAll(async () => {
  await app?.close();
});

test('the hub lists every grant under its project, and a revoke takes it off the disk', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  await window.locator('.status-strip').getByRole('button', { name: /settings/i }).click();
  await window.locator('.settings-nav-item', { hasText: 'Permissions' }).click();

  const panel = window.locator('.grants');
  await expect(panel.locator('.grant-group', { hasText: 'webshop' })).toContainText('Every pnpm command');
  await expect(panel.locator('.grant-group', { hasText: 'webshop' })).toContainText('git status');
  await expect(panel.locator('.grant-group', { hasText: 'No project' })).toContainText('edit_file');

  await panel.locator('.grant-row', { hasText: 'Every pnpm command' }).getByRole('button', { name: /revoke/i }).click();

  await expect(panel.locator('.grant-row', { hasText: 'Every pnpm command' })).toHaveCount(0);
  const onDisk = JSON.parse(await readFile(join(dataDir, 'config', 'grants.json'), 'utf8')) as {
    projects: Record<string, unknown[]>;
  };
  expect(onDisk.projects['proj-a']).toEqual([{ tool: 'run_shell', exactCommand: 'git status' }]);
});
