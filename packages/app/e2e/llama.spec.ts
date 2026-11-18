/**
 * Keeping llama.cpp, end to end: the screen says which llama.cpp would run,
 * whether a newer build is published and how much it weighs — before
 * anything is downloaded — and downloads it on a click, verified. The
 * releases are a local server of the test: a test run never asks GitHub.
 */

import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';

const MODELS = { 'gemma-4-e2e': { paddingBytes: 1024 * 1024 } };

test('an older llama.cpp, a newer build published: both are said, with the size, and nothing is downloaded', async ({ launch }) => {
  const { page, releases } = await launch({ managed: { models: MODELS, releases: true } });
  const status = page.locator('.llama-status');
  // The fake binary answers `version: 9999 (fake)`.
  await expect(status).toContainText('llama.cpp b9999, trouvé sur cette machine.');
  await expect(status).toContainText('La b12383 est publiée');
  await expect(page.getByRole('button', { name: /^Télécharger la b12383 · \d+ (o|Ko|Mo)$/ })).toBeVisible();
  expect(releases!.downloads).toBe(0);
  // What is there still runs: the old build does not stop anyone.
  await expect(page.getByRole('button', { name: 'Démarrer' })).toBeEnabled();
});

test('« Télécharger » downloads the build, verified, and the screen says it is up to date', async ({ launch }) => {
  const { page, releases } = await launch({ managed: { models: MODELS, releases: true } });
  await page.getByRole('button', { name: /^Télécharger la b12383/ }).click();
  const status = page.locator('.llama-status');
  await expect(status).toContainText('llama.cpp b12383, installé par bonaparte.', { timeout: 20_000 });
  await expect(status).toContainText('à jour');
  await expect(page.getByRole('button', { name: /^Télécharger/ })).toHaveCount(0);
  expect(releases!.downloads).toBe(1);
});

test('no llama.cpp on the machine: « Démarrer » waits, and the board’s card offers its three ways (task 12.3)', async ({ launch }) => {
  const { page } = await launch({ managed: { models: MODELS, releases: true, llama: 'missing' } });
  const card = page.getByRole('alert').filter({ hasText: 'llama.cpp introuvable' });
  await expect(card).toContainText('Au premier lancement');
  await expect(card).toContainText('Ni llama-server ni llama dans ton PATH');
  await expect(card.getByRole('button', { name: /^Télécharger la b12383/ })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Choisir un fichier…' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Brancher un service existant' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Démarrer' })).toBeDisabled();
});

test('llama.cpp missing: a file that is no llama.cpp is refused, said; « Brancher un service existant » goes to the services', async ({ launch }) => {
  const notLlama = join(tmpdir(), `bp-not-llama-${process.pid}.txt`);
  await writeFile(notLlama, 'not a program');
  const { page } = await launch({ managed: { models: MODELS, releases: true, llama: 'missing' }, env: { BONAPARTE_E2E_PICK_FILE: notLlama } });
  const card = page.getByRole('alert').filter({ hasText: 'llama.cpp introuvable' });
  await card.getByRole('button', { name: 'Choisir un fichier…' }).click();
  await expect(card).toContainText('Ce fichier n’est pas un llama.cpp qui répond');
  await expect(page.getByRole('button', { name: 'Démarrer' })).toBeDisabled();
  await card.getByRole('button', { name: 'Brancher un service existant' }).click();
  await expect(page.getByRole('radio', { name: /Un service existant/ })).toBeChecked();
});

test('GitHub out of reach: the screen says it could not check, never « à jour »', async ({ launch }) => {
  const { page } = await launch({
    managed: { models: MODELS },
    env: { BONAPARTE_E2E_LLAMA_RELEASES: 'http://127.0.0.1:9/releases' },
  });
  const status = page.locator('.llama-status');
  await expect(status).toContainText('Impossible de vérifier les nouvelles versions de llama.cpp.');
  await expect(status).not.toContainText('à jour');
});
