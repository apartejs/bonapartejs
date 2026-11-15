/**
 * « Réglages · Modèles » (task 5.7): the models found, each with its size;
 * the default chosen is kept; « Ajouter un dossier » adds a folder from the
 * system's dialog, and its models appear; « Chercher sur tout le disque »
 * says how far it went, and the folders where it found models join the search.
 */

import { writeFakeGguf } from '@aparte/bonaparte-core/testing';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';

const MODELS = { 'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 } };

async function openModels(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Démarrer' }).click();
  await expect(page.getByRole('button', { name: 'Réglages', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: 'Modèles' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Modèles' })).toBeVisible();
}

test('the models found, their default kept, and a folder added from the dialog', async ({ launch }) => {
  const added = await mkdtemp(join(tmpdir(), 'bp-models-'));
  try {
    await writeFakeGguf(join(added, 'gemma-4-ajoute.gguf'), {});
    const { page, dataDir } = await launch({ managed: { models: MODELS }, env: { BONAPARTE_E2E_PICK_FOLDER: added } });
    await openModels(page);
    await expect(page.getByRole('row', { name: /gemma-4-e2e/ })).toBeVisible();
    await page.getByRole('radio', { name: 'Par défaut : gemma-4-e2e' }).check();
    await expect
      .poll(async () => JSON.parse(await readFile(join(dataDir, 'config', 'global.json'), 'utf8')).settings?.defaultModel ?? '')
      .toMatch(/gemma-4-e2e\.gguf$/);

    await page.getByRole('button', { name: 'Ajouter un dossier' }).click();
    await expect(page.getByText(added)).toBeVisible();
    await expect(page.getByRole('row', { name: /gemma-4-ajoute/ })).toBeVisible();
  } finally {
    await rm(added, { recursive: true, force: true });
  }
});

test('the whole-disk search says how far it went, and what it found joins the search', async ({ launch }) => {
  const disk = await mkdtemp(join(tmpdir(), 'bp-disk-'));
  try {
    const deep = join(disk, 'jeux', 'modeles');
    await mkdir(deep, { recursive: true });
    await writeFakeGguf(join(deep, 'gemma-4-disque.gguf'), {});
    const { page } = await launch({ managed: { models: MODELS }, env: { BONAPARTE_E2E_DISK_ROOT: disk } });
    await openModels(page);
    await page.getByRole('button', { name: 'Chercher sur tout le disque (plus long)' }).click();
    await expect(page.getByRole('status')).toContainText(/1 dossier avec des modèles/, { timeout: 15_000 });
    await expect(page.getByText(deep)).toBeVisible();
    await expect(page.getByRole('row', { name: /gemma-4-disque/ })).toBeVisible();
  } finally {
    await rm(disk, { recursive: true, force: true });
  }
});
