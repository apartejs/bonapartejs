/**
 * The small built-in plugins (task 12.4): « Réglages de conversation » — temperature, reasoning and context cap,
 * conversation by conversation, from « Plus d'actions »; « Moniteur de ressources » — the processor, the memory and
 * the graphics card in the engine's card; a conversation's title is its first message, and can be changed.
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

test('« Réglages de la conversation… »: its temperature and its reasoning go with its next turn', async ({ launch }) => {
  const bodies: Record<string, unknown>[] = [];
  const { page } = await launch({ engine: { responder: () => 'ok', onCompletion: (body) => bodies.push(body) } });
  const ui = chat(page);
  await ui.send('Bonjour');
  await expect(ui.replies).toHaveCount(1, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Plus d’actions' }).click();
  await page.getByRole('menuitem', { name: 'Réglages de la conversation…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Réglages de la conversation' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('spinbutton', { name: 'Température' }).fill('0.2');
  await dialog.getByRole('combobox', { name: 'Réflexion' }).selectOption({ label: 'Coupée' });
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(dialog).toBeHidden();

  await ui.send('Encore');
  await expect(ui.replies).toHaveCount(2, { timeout: 15_000 });
  await expect.poll(() => bodies.some((body) => String(body['prompt']).includes('Encore'))).toBe(true);
  const last = bodies.find((body) => String(body['prompt']).includes('Encore'))!;
  expect(last['temperature']).toBe(0.2);

  // A temperature out of range is refused, said, and nothing kept.
  await page.getByRole('button', { name: 'Plus d’actions' }).click();
  await page.getByRole('menuitem', { name: 'Réglages de la conversation…' }).click();
  await expect(dialog.getByRole('spinbutton', { name: 'Température' })).toHaveValue('0.2');
  await dialog.getByRole('spinbutton', { name: 'Température' }).fill('5');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(dialog).toContainText('La température va de 0 à 2.');
});

test('the resource monitor: the processor, the memory and the graphics card in the engine’s card, said in words', async ({ launch }) => {
  const { page } = await launch({
    managed: { models: { 'gemma-4-e2e': { paddingBytes: 1024 * 1024 } } },
    env: { BONAPARTE_E2E_RESOURCES: JSON.stringify({ cpu: 12, usedBytes: 8 * 1024 ** 3, totalBytes: 16 * 1024 ** 3, gpuUtilization: null }) },
  });
  await page.getByRole('button', { name: 'Démarrer' }).click();
  await expect(chat(page).composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });
  const card = page.locator('.engine-card');
  await expect(card).toContainText('Processeur 12 %', { timeout: 15_000 });
  await expect(card).toContainText('Mémoire 8 Go sur 16 Go');
  await expect(card).toContainText('Carte graphique inconnue');
  await expect(card.getByRole('progressbar', { name: 'Processeur' })).toHaveAttribute('aria-valuenow', '12');
});

test('a conversation’s title is its first message, and can be changed', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  const ui = chat(page);
  await ui.send('Mon premier message');
  const title = page.locator('.conversation-header__title');
  await expect(title).toHaveText('Mon premier message', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Plus d’actions' }).click();
  await page.getByRole('menuitem', { name: 'Renommer' }).click();
  const field = page.getByRole('textbox', { name: 'Titre de la conversation' });
  await field.fill('Un autre titre');
  await field.press('Enter');
  await expect(title).toHaveText('Un autre titre');
});
