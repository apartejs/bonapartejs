/**
 * The settings hub, end to end: opened from the status strip, its sections,
 * and the form engine behind them — a setting changed there shows where its
 * value now comes from, and reverts to inheritance on demand.
 *
 * Written as the shell moved to shadcn/ui: this is what the hub must keep
 * doing whatever dresses it.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;

test.beforeAll(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-settings-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({ backend: { mode: 'managed', binPath: 'llama' }, locale: 'en' }),
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

test('a sampling setting changed in the hub stops being inherited, and reverts', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();

  await window.getByRole('button', { name: 'Settings' }).click();
  const hub = window.locator('.settings-hub');
  await expect(hub).toBeVisible();
  await expect(hub.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await hub.getByRole('button', { name: 'Sampling' }).click();
  const temperature = hub.locator('#set-global-temperature');
  await expect(temperature).toBeVisible();
  const row = hub.locator('.setting-row', { has: window.locator('#set-global-temperature') });
  await expect(row).toContainText('inherited');

  await temperature.fill('0.35');
  await temperature.blur();
  await expect(row).not.toContainText('inherited', { timeout: 5_000 });
  await expect(row.getByRole('button', { name: 'Reset' })).toBeVisible();

  await row.getByRole('button', { name: 'Reset' }).click();
  await expect(row).toContainText('inherited', { timeout: 5_000 });

  await hub.getByRole('button', { name: 'Plugins' }).click();
  // The five built-in plugins are listed, each with its state.
  await expect(hub.locator('.plugin-row')).toHaveCount(5);

  await hub.getByRole('button', { name: 'Close' }).click();
  await expect(hub).toBeHidden();
});
