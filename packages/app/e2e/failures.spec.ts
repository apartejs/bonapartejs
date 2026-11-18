/**
 * When something breaks (task 12.3, board « Quand quelque chose casse »): each failure says what happened, what is
 * safe and what can be done — never a blank page, never « erreur inconnue ».
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const MODELS = { 'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 } };
const MiB = 1024 * 1024;

test('a model too big for the card: what it needs and what the card has, nothing loaded before a choice', async ({ launch }) => {
  const { page, engineRequests } = await launch({ managed: { models: MODELS, gpuBytes: 64 * MiB } });
  await expect(page.getByRole('heading', { name: 'Préparons le moteur' })).toBeVisible();
  await page.getByRole('button', { name: 'Démarrer' }).click();
  const card = page.getByRole('alert').filter({ hasText: 'Le modèle ne tient pas dans la carte' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('Avant de charger');
  await expect(card).toContainText(/Il faut .+, ta carte en a 64 Mo/);
  await expect(card).toContainText('Rien n’est chargé tant que tu n’as pas choisi.');
  await expect(card).not.toContainText('inconnue');
  // Not even one layer fits on 64 MiB: the processor offer is said impossible, a smaller model offered.
  await expect(card.getByRole('button', { name: 'Un modèle plus petit…' })).toBeVisible();
  const state = await page.evaluate(() => (window as unknown as { bonaparte: { invoke(name: string, input: unknown): Promise<{ status: string }> } }).bonaparte.invoke('engine.state', undefined));
  expect(state.status).toBe('stopped');
  expect(await engineRequests()).toEqual([]);
});

test('the engine stops during a reply: what is safe, what is lost, its log, and « Relancer et relire »', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'un deux trois quatre cinq', failAfter: 2 } });
  await chat(page).send('Compte');
  const card = page.getByRole('alert').filter({ hasText: 'Le moteur s’est arrêté' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('Pendant une réponse');
  await expect(card).toContainText('Sauf : la conversation, son journal est sur disque.');
  await expect(card).toContainText('Perdu : la mémoire du dernier tour');
  await expect(card).not.toContainText('inconnue');
  // What was written before it stopped is kept.
  await expect(chat(page).replyText).toContainText('un deux');

  await card.getByRole('button', { name: 'Voir le journal du moteur' }).click();
  const log = page.getByRole('dialog', { name: 'Journal du moteur' });
  await expect(log).toBeVisible();
  await log.getByRole('button', { name: 'Fermer' }).click();
  await expect(log).toBeHidden();

  await card.getByRole('button', { name: 'Relancer et relire' }).click();
  await expect(card).toBeHidden({ timeout: 15_000 });
});
