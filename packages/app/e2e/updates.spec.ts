/**
 * « Mises à jour » (task 13.1, board « Une mise à jour », design §7.6): each update says what it costs before it is
 * done; nothing installs while a conversation works; « Mettre à jour l'app toute seule » is the app's alone.
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const UPDATE = JSON.stringify({ version: '1.1.0', bytes: 90 * 1024 * 1024, notes: 'La recherche Ctrl K, et des correctifs.' });
const restarted = (app: { evaluate<T>(run: () => T): Promise<T> }) =>
  app.evaluate(() => (globalThis as { __bonaparteUpdater?: { restarted: number } }).__bonaparteUpdater?.restarted ?? -1);

test('no update ready: no entry in the sidebar', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await expect(chat(page).composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /^Mises à jour/ })).toHaveCount(0);
});

test('the app’s update: its card says its cost, and « Redémarrer » waits for the end of the reply', async ({ launch }) => {
  const { page, app } = await launch({ engine: { responder: () => 'un deux trois quatre cinq six sept huit', paceMs: 250 }, env: { BONAPARTE_E2E_UPDATE: UPDATE } });
  const entry = page.getByRole('button', { name: 'Mises à jour, 1 prête' });
  await expect(entry).toBeVisible({ timeout: 15_000 });

  const ui = chat(page);
  await ui.send('Compte');
  await entry.click();
  const dialog = page.getByRole('dialog', { name: 'Mises à jour' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Une mise à jour est prête. Elle dit ce qu’elle coûte avant de le faire.');
  const card = dialog.locator('.update-card').first();
  await expect(card).toContainText('bonaparte 1.1.0');
  await expect(card).toContainText('l’app');
  await expect(card).toContainText('La recherche Ctrl K, et des correctifs.');
  await expect(card).toContainText('Redémarre l’app, environ 5 s. Les conversations et leur mémoire restent telles quelles.');
  await expect(dialog).toContainText('Rien ne s’installe pendant qu’une conversation travaille : la mise à jour attend la fin du tour.');

  // Asked while the reply runs: it waits, says so, and nothing restarts before the end of the turn.
  await card.getByRole('button', { name: 'Redémarrer' }).click();
  await expect(card.getByRole('button', { name: 'Après ce tour…' })).toBeVisible();
  expect(await restarted(app)).toBe(0);
  await expect(ui.replies).toHaveCount(1, { timeout: 15_000 });
  await expect.poll(() => restarted(app), { timeout: 15_000 }).toBe(1);
});

test('« Mettre à jour l’app toute seule »: off by default — the download said first —, switched on and kept (review of round 6)', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' }, env: { BONAPARTE_E2E_UPDATE: UPDATE } });
  await page.getByRole('button', { name: 'Mises à jour, 1 prête' }).click({ timeout: 15_000 });
  const dialog = page.getByRole('dialog', { name: 'Mises à jour' });
  const auto = dialog.getByRole('switch', { name: 'Mettre à jour l’app toute seule.' });
  await expect(dialog).toContainText('Le moteur et le modèle demandent toujours.');
  // Off: nothing is downloaded unannounced, and the app's card says what it downloads first.
  await expect(auto).not.toBeChecked();
  await expect(dialog.locator('.update-card').first()).toContainText('90 Mo à télécharger d’abord.');
  await auto.click();
  await expect(auto).toBeChecked();
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Mises à jour, 1 prête' }).click();
  await expect(auto).toBeChecked();
  await expect(dialog.locator('.update-card').first()).not.toContainText('à télécharger d’abord');
});

test('a new version of a model: its download, the conversations it makes to read again, and « Garder la version actuelle »', async ({ launch }) => {
  const { page, hub } = await launch({
    managed: { models: { 'gemma-4-e2e': { paddingBytes: 1024 * 1024 } } },
    hub: { models: { 'gemma-4-e2e-v2': { family: 'gemma', replaces: ['gemma-4-e2e.gguf'] } } },
  });
  await page.getByRole('button', { name: 'Démarrer' }).click();
  const ui = chat(page);
  await expect(ui.composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });
  await ui.send('Bonjour');
  await expect(ui.replies).toHaveCount(1, { timeout: 15_000 });

  await page.getByRole('button', { name: 'Mises à jour, 1 prête' }).click({ timeout: 15_000 });
  const dialog = page.getByRole('dialog', { name: 'Mises à jour' });
  const card = dialog.locator('.update-card');
  await expect(card).toContainText('gemma-4-e2e-v2');
  await expect(card).toContainText('le modèle');
  await expect(card.getByRole('note')).toContainText(/à télécharger\. Ensuite, la conversation gardée en mémoire devra être relue à leur réouverture : environ .+ au total, payées une à une\. Garder la version actuelle évite tout ça\./);
  expect(hub?.downloads).toBe(0);

  await card.getByRole('button', { name: 'Garder la version actuelle' }).click();
  await expect(dialog).toContainText('Rien à mettre à jour pour l’instant.');
  expect(hub?.downloads).toBe(0);
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(page.getByRole('button', { name: /^Mises à jour/ })).toHaveCount(0);
});

test('the app’s own update that cannot be checked is said: a private repository sends the person to the releases (audit N4)', async ({ launch }) => {
  // What electron-updater throws when the repository is private: its releases feed answers 404 to an app with no token.
  const fail = JSON.stringify({ fail: { statusCode: 404, message: 'HttpError: 404 "method: GET url: https://github.com/apartejs/bonapartejs/releases.atom"' } });
  const { page } = await launch({ engine: { responder: () => 'ok' }, env: { BONAPARTE_E2E_UPDATE: fail } });
  // Nothing is ready, but the entry is there: a check that fails is never silence.
  const entry = page.getByRole('button', { name: 'Mises à jour, l’app n’a pas pu être vérifiée' });
  await expect(entry).toBeVisible({ timeout: 15_000 });
  await entry.click();
  const dialog = page.getByRole('dialog', { name: 'Mises à jour' });
  await expect(dialog.getByRole('note')).toHaveText(
    'La mise à jour de l’app n’a pas pu être vérifiée : les releases de bonaparte sont dans un dépôt GitHub privé, que l’app ne peut pas lire. Télécharge le nouvel installeur depuis les releases du dépôt, connecté à GitHub.',
  );
  await expect(dialog).toContainText('Rien d’autre à mettre à jour pour l’instant.');
  await expect(dialog).not.toContainText(/inconnu/);
  await expect(dialog.locator('.update-card')).toHaveCount(0);
});
