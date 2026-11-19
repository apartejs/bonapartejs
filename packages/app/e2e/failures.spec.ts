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

test('« Une partie sur le processeur » holds for that model, said in « Moteur et mémoire », where it goes back on the card (review 12)', async ({ launch }) => {
  // Some 16 MiB a layer over a margin of 512 MiB: about eleven layers fit on 700 MiB.
  const { page } = await launch({ managed: { models: MODELS, gpuBytes: 700 * MiB } });
  await page.getByRole('button', { name: 'Démarrer' }).click();
  const card = page.getByRole('alert').filter({ hasText: 'Le modèle ne tient pas dans la carte' });
  await card.getByRole('button', { name: /^Une partie sur le processeur/ }).click();
  await expect(chat(page).composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: 'Moteur et mémoire' }).click();
  const row = page.locator('.setting-row', { hasText: 'Sur la carte graphique' });
  await expect(row).toContainText(/\d+ couches? du modèle sur la carte, le reste sur le processeur/);
  await row.getByRole('button', { name: 'Tout sur la carte' }).click();
  // Said before anything restarts, as any launch setting.
  await expect(page.getByRole('button', { name: 'Redémarrer maintenant' })).toBeVisible();
});

test('the reply the engine cut says so in its own bubble, after a reload too (aparté 1.14, apartejs/aparte#265)', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'un deux trois quatre cinq', failAfter: 2 } });
  await chat(page).send('Compte');
  const said = 'Le moteur s’est arrêté pendant cette réponse. La conversation est sauve ; sa mémoire est à relire.';
  const bubble = page.locator('.bonaparte-live-chat:not([hidden]) .aparte-segment-error[data-app-code="engine-died"]');
  await expect(bubble).toContainText(said, { timeout: 15_000 });
  await page.reload();
  await expect(bubble).toContainText(said, { timeout: 15_000 });
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

test('the disk nearly full leaves the composer’s place to the next turn: it is checked again when that one ends (review 12)', async ({ launch }) => {
  const { page } = await launch({
    managed: { models: MODELS },
    env: { BONAPARTE_E2E_FREE_BYTES: String(1024 * 1024), FAKE_LLAMA_ANSWER: 'un deux trois quatre cinq six sept huit', FAKE_LLAMA_PACE_MS: '150' },
  });
  await page.getByRole('button', { name: 'Démarrer' }).click();
  const ui = chat(page);
  await expect(ui.composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });
  await ui.send('Bonjour');
  const card = page.getByRole('alert').filter({ hasText: 'Le disque est presque plein' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await ui.send('Encore');
  // While the turn runs, what it may ask (an approval, a question) has the place: the card is gone.
  await expect(ui.streamingReplies).toHaveCount(1);
  await expect(card).toBeHidden();
  await expect(ui.streamingReplies).toHaveCount(0, { timeout: 15_000 });
  await expect(card).toBeVisible({ timeout: 15_000 });
});

test('the disk nearly full, said as a turn ends: how much is free, and the oldest memory to let go', async ({ launch }) => {
  const { page } = await launch({ managed: { models: MODELS }, env: { BONAPARTE_E2E_FREE_BYTES: String(1024 * 1024) } });
  await page.getByRole('button', { name: 'Démarrer' }).click();
  const ui = chat(page);
  await expect(ui.composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });
  await ui.send('Bonjour');
  const card = page.getByRole('alert').filter({ hasText: 'Le disque est presque plein' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText(/Plus que 1 Mo libres sur /);
  // Nothing older to let go yet: said as it is.
  await expect(card).toContainText('Aucune mémoire ancienne à libérer');

  await page.keyboard.press('Control+N');
  // The new conversation shown first: right after the key, the field found could still be the one of the chat
  // that is being hidden, and Playwright would wait on it for ever.
  await expect(page.getByRole('heading', { name: 'Nouvelle conversation', level: 1 })).toBeVisible();
  await expect(ui.userMessages).toHaveCount(0);
  await ui.send('Une autre question');
  await expect(card).toContainText('il faut libérer une mémoire ancienne', { timeout: 15_000 });
  await card.getByRole('button', { name: 'Libérer la plus ancienne' }).click();
  await expect(card).toContainText('Aucune mémoire ancienne à libérer', { timeout: 15_000 });
  await card.getByRole('button', { name: 'Choisir lesquelles…' }).click();
  await expect(page.getByRole('heading', { name: 'Moteur et mémoire' })).toBeVisible();
});
