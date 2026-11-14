/**
 * Keeping llama.cpp, end to end: the screen says which llama.cpp would run,
 * whether a newer build is published and how much it weighs — before
 * anything is downloaded — and downloads it on a click, verified. The
 * releases are a local server of the test: a test run never asks GitHub.
 */

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

test('no llama.cpp on the machine: « Démarrer » waits, and the download is offered', async ({ launch }) => {
  const { page } = await launch({ managed: { models: MODELS, releases: true, llama: 'missing' } });
  await expect(page.locator('.llama-status')).toContainText('llama.cpp n’est pas sur cette machine.');
  await expect(page.getByRole('button', { name: /^Télécharger la b12383/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Démarrer' })).toBeDisabled();
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
