/**
 * A plugin switched off in the hub (P3.2): the host tears it down whole —
 * its view leaves the tooling panel at once — the choice is remembered,
 * and switching it back on brings the view back, live.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let dataDir: string;

test.beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-plugins-toggle-'));
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
  app = await electron.launch({ args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')], env });
});

test.afterAll(async () => {
  await app?.close();
});

async function disabledPlugins(): Promise<string[] | undefined> {
  const config = JSON.parse(await readFile(join(dataDir, 'config', 'global.json'), 'utf8')) as {
    disabledPlugins?: string[];
  };
  return config.disabledPlugins;
}

test('switched off, a plugin leaves the panel and stays off; switched on, it comes back', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  const terminalView = window.locator('.tooling-home-view', { hasText: 'Terminal' });
  await expect(terminalView).toBeVisible();

  await window.getByRole('button', { name: 'Settings' }).click();
  const hub = window.locator('.settings-hub');
  await hub.getByRole('button', { name: 'Plugins' }).click();
  const row = hub.locator('.plugin-row', { hasText: 'Terminal' });
  const toggle = row.getByRole('switch', { name: 'Use Terminal' });
  await expect(toggle).toBeChecked();

  await toggle.click();
  await expect(row.locator('.plugin-state-off')).toHaveText('off');
  await expect(toggle).not.toBeChecked();
  await expect.poll(disabledPlugins).toEqual(['terminal']);
  await expect(terminalView).toBeHidden();

  await toggle.click();
  await expect(row.locator('.plugin-state-active')).toBeVisible();
  await expect.poll(disabledPlugins).toEqual([]);
  await expect(terminalView).toBeVisible();
});
