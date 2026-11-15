/**
 * The settings (task 5.7, boards « Réglages · Général » and « Apparence »):
 * three groups and the versions at the foot; « Conversations » goes back; a
 * setting changed is kept after a restart; the language changes the
 * interface at once; the theme, the accent and the text size apply at once;
 * « Exporter les conversations… » writes one Markdown file each; « Ouvrir le
 * dossier » opens the data folder, whose path the window never names.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

async function openSettings(page: Page, label = 'Réglages'): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click();
}

test('« Réglages » shows three groups, the versions at the foot, and « Conversations » goes back', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await openSettings(page);
  const nav = page.getByRole('navigation', { name: 'Réglages' });
  await expect(nav).toBeVisible();
  for (const group of ['Application', 'Moteur', 'Agent']) await expect(nav.getByText(group, { exact: true })).toBeVisible();
  for (const entry of ['Général', 'Apparence', 'Moteur et mémoire', 'Modèles', 'Permissions']) {
    await expect(nav.getByRole('link', { name: entry, exact: true })).toBeVisible();
  }
  const { version } = JSON.parse(await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string };
  await expect(nav).toContainText(`bonaparte ${version} · llama.cpp`);
  await expect(page.getByRole('heading', { level: 1, name: 'Général' })).toBeVisible();
  await nav.getByRole('link', { name: 'Conversations' }).click();
  await expect(nav).toBeHidden();
  await expect(chat(page).editor).toBeVisible();
});

test('a setting changed is kept after a restart', async ({ launch }) => {
  const first = await launch({ engine: { responder: () => 'ok' }, keepData: true });
  await openSettings(first.page);
  const reopen = first.page.getByRole('switch', { name: 'Rouvrir la dernière conversation' });
  await expect(reopen).toBeChecked();
  await reopen.click();
  await expect(reopen).not.toBeChecked();
  await first.page.getByRole('radio', { name: 'Une seule liste' }).check();
  // Kept by the core: in the configuration file before the app goes.
  await expect
    .poll(async () => JSON.parse(await readFile(join(first.dataDir, 'config', 'global.json'), 'utf8')).settings ?? {})
    .toMatchObject({ reopenLast: false, sidebarGrouping: 'single' });
  await first.close();

  const again = await launch({ engine: { responder: () => 'ok' }, dataDir: first.dataDir });
  await openSettings(again.page);
  await expect(again.page.getByRole('switch', { name: 'Rouvrir la dernière conversation' })).not.toBeChecked();
  await expect(again.page.getByRole('radio', { name: 'Une seule liste' })).toBeChecked();
});

test('the language changes the interface at once', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' }, env: { BONAPARTE_LOCALE: '' } });
  await openSettings(page);
  await page.getByRole('radio', { name: 'English' }).check();
  await expect(page.getByRole('heading', { level: 1, name: 'General' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Settings' })).toBeVisible();
});

test('the theme, the accent and the text size apply at once', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await openSettings(page);
  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: 'Apparence' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Apparence' })).toBeVisible();
  const root = (attribute: string) => page.evaluate((name) => document.documentElement.getAttribute(name), attribute);
  const token = (name: string) => page.evaluate((variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim(), name);

  await page.getByRole('radio', { name: 'Sombre' }).check();
  await expect.poll(() => root('data-aparte-theme')).toBe('dark');
  await page.getByRole('radio', { name: 'Violet' }).check();
  await expect.poll(() => token('--bonaparte-accent')).toBe('#6D4AFF');
  const before = await token('--aparte-font-scale');
  await page.getByRole('radio', { name: 'Grande' }).check();
  await expect.poll(() => token('--aparte-font-scale')).not.toBe(before);
  await page.getByRole('radio', { name: 'Comme Windows' }).check();
  await expect.poll(() => root('data-bonaparte-theme')).toBe('system');
});

test('« Exporter les conversations… » writes one Markdown file each, and « Ouvrir le dossier » opens the data folder', async ({ launch }) => {
  const folder = await mkdtemp(join(tmpdir(), 'bp-export-'));
  try {
    const { app, page, dataDir } = await launch({ engine: { responder: () => 'ok' }, env: { BONAPARTE_E2E_PICK_FOLDER: folder } });
    await chat(page).send('Le parseur des heures');
    await expect(chat(page).replyText).toHaveText('ok', { timeout: 15_000 });
    await openSettings(page);
    await page.getByRole('button', { name: 'Exporter les conversations…' }).click();
    await expect(page.getByText(/1 conversation exportée/)).toBeVisible();
    const [made] = await readdir(folder);
    const files = await readdir(join(folder, made!));
    expect(files).toHaveLength(1);
    expect(await readFile(join(folder, made!, files[0]!), 'utf8')).toContain('Le parseur des heures');

    await page.getByRole('button', { name: 'Ouvrir le dossier' }).click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as { __openedDataFolder?: string[] }).__openedDataFolder ?? []))
      .toEqual([dataDir]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
