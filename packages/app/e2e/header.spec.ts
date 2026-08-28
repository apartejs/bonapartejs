/**
 * The conversation header and the sidebar's chrome, end to end: renaming a
 * conversation from its title, the project popover, the sidebar's organise
 * menu switching the grouping. Written before those controls moved to
 * shadcn/ui: this is what they must keep doing whatever dresses them.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;

test.beforeAll(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-header-'));
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

test('the title renames the conversation, and the sidebar follows', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();

  await window.locator('.conv-header .conv-title').click();
  const input = window.locator('.conv-header .conv-title-input');
  await expect(input).toBeVisible();
  await input.fill('Renamed by the header');
  await input.press('Enter');

  await expect(window.locator('.conv-header .conv-title')).toContainText('Renamed by the header');
  await expect(window.locator('.conv-item-active')).toContainText('Renamed by the header');
});

test('the project chip opens its panel, which explains the absence of a project', async () => {
  const window = await app.firstWindow();
  const chip = window.locator('.conv-header .conv-chip');
  await chip.click();
  const popover = window.getByRole('dialog', { name: 'Conversation project' });
  await expect(popover).toBeVisible();
  await expect(popover.getByRole('button', { name: /Create a project/ })).toBeVisible();
  // A click elsewhere closes it.
  await window.locator('.chat-wrap').click();
  await expect(popover).toBeHidden();
});

test('Escape closes the project panel', async () => {
  const window = await app.firstWindow();
  await window.locator('.conv-header .conv-chip').click();
  const popover = window.getByRole('dialog', { name: 'Conversation project' });
  await expect(popover).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(popover).toBeHidden();
});

test('the organise menu switches the sidebar to one list, where rows name their project', async () => {
  const window = await app.firstWindow();
  await window.getByRole('button', { name: 'Organise' }).click();
  const oneList = window.getByRole('menuitemradio', { name: 'In one list' });
  await expect(oneList).toBeVisible();
  await oneList.click();
  await expect(window.locator('.conv-item-active .conv-noproject')).toBeVisible();

  // Whether the menu closed on the choice or not, it is closed now.
  await window.keyboard.press('Escape');
  await window.getByRole('button', { name: 'Organise' }).click();
  await window.getByRole('menuitemradio', { name: 'By project' }).click();
  await expect(window.locator('.conv-item-active .conv-noproject')).toHaveCount(0);
});
