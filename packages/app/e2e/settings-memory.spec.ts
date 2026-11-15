/**
 * « Moteur et mémoire » (task 5.7): the engine since when; the memory of each
 * conversation — in the engine, saved —; « Libérer » makes it one to read
 * again, with what that costs, and reopening the conversation says the person
 * let it go; « Redémarrer » says what it costs before; « Décharger » unloads.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const MODELS = { 'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 } };

async function ask(page: Page, text: string): Promise<void> {
  const ui = chat(page);
  const before = await ui.replies.count();
  await ui.send(text);
  await expect(ui.replies).toHaveCount(before + 1, { timeout: 15_000 });
  await expect(ui.streamingReplies).toHaveCount(0, { timeout: 15_000 });
}

test('the engine, the memory of each conversation, « Libérer », « Redémarrer » and « Décharger »', async ({ launch }) => {
  const { page } = await launch({ managed: { models: MODELS } });
  await page.getByRole('button', { name: 'Démarrer' }).click();
  await expect(chat(page).composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });
  await ask(page, 'Première question');
  await page.getByRole('button', { name: 'Nouvelle conversation' }).first().click();
  await expect(chat(page).userMessages).toHaveCount(0);
  await ask(page, 'Deuxième question');

  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: 'Moteur et mémoire' }).click();
  const engine = page.getByRole('region', { name: 'Moteur', exact: true });
  await expect(engine).toContainText('En marche depuis');
  await expect(engine).toContainText('gemma-4-e2e');
  await expect(page.getByRole('row', { name: /Deuxième question.*Dans le moteur/ })).toBeVisible();
  const first = page.getByRole('row', { name: /Première question/ });
  await expect(first).toContainText('Sauvée');
  await first.getByRole('button', { name: 'Libérer' }).click();
  await expect(first).toContainText(/Libérée · à relire, ~/);
  await expect(page.getByRole('region', { name: 'Préfixe partagé' })).toContainText('jetons');

  // Reopened, the conversation says the person let its memory go — and what reading it again costs.
  const settings = page.getByRole('navigation', { name: 'Réglages' });
  await settings.getByRole('link', { name: 'Conversations' }).click();
  await page.locator('aparte-conversation-list').getByRole('button', { name: /^Première question/ }).first().click();
  await expect(page.locator('.memory-banner')).toContainText('Tu as libéré sa mémoire');
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await settings.getByRole('link', { name: 'Moteur et mémoire' }).click();

  await page.getByRole('button', { name: 'Redémarrer' }).click();
  const question = page.getByRole('dialog', { name: 'Redémarrer le moteur ?' });
  await expect(question).toContainText(/Le modèle se recharge : ~/);
  await question.getByRole('button', { name: 'Redémarrer' }).click();
  await expect(engine).toContainText('En marche depuis', { timeout: 20_000 });

  await page.getByRole('button', { name: 'Décharger' }).click();
  await expect(engine).toContainText('Déchargé', { timeout: 15_000 });

  // Back to the conversations: no model runs, so the window offers to start one again.
  await settings.getByRole('link', { name: 'Conversations' }).click();
  await expect(page.getByRole('button', { name: 'Démarrer' })).toBeVisible({ timeout: 15_000 });
});
