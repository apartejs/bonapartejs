/**
 * The conversation's header (task 5.6, board « Conversation au travail »):
 * its title, where its memory is, and « Plus d’actions » — a menu the
 * keyboard drives: Enter opens it, the arrows move, Escape closes it and gives
 * the focus back to its button. Renaming from it renames in the list too.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';
import { conversationList } from './fixtures/conversations.js';

async function ask(page: Page, text: string): Promise<void> {
  const ui = chat(page);
  await ui.send(text);
  await expect(ui.replies).toHaveCount(1, { timeout: 15_000 });
  await expect(ui.streamingReplies).toHaveCount(0, { timeout: 15_000 });
}

test('« Plus d’actions » opens on Enter, moves with the arrows, and Escape gives the focus back', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await ask(page, 'Le parseur des heures');
  await expect(page.getByRole('heading', { level: 1, name: 'Le parseur des heures' })).toBeVisible();

  const more = page.getByRole('button', { name: 'Plus d’actions' });
  await more.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Plus d’actions' });
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  await expect(items).toHaveText(['Renommer', 'Épingler', 'Réglages de la conversation…', 'Archiver', 'Supprimer…']);
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
});

test('« Renommer » renames the conversation, in the list too', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await ask(page, 'Le parseur des heures');
  await page.getByRole('button', { name: 'Plus d’actions' }).click();
  await page.getByRole('menuitem', { name: 'Renommer' }).click();
  const field = page.getByRole('textbox', { name: 'Titre de la conversation' });
  await expect(field).toBeFocused();
  await field.fill('Les heures décimales');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Les heures décimales' })).toBeVisible();
  await expect(conversationList(page).row('Les heures décimales')).toBeVisible();
});

test('« Supprimer… » asks first, says what goes, and opens a new conversation', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await ask(page, 'À supprimer');
  await page.getByRole('button', { name: 'Plus d’actions' }).click();
  await page.getByRole('menuitem', { name: 'Supprimer…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Supprimer « À supprimer » ?' });
  await expect(dialog).toContainText('sa mémoire');
  await dialog.getByRole('button', { name: 'Supprimer' }).click();
  await expect(dialog).toBeHidden();
  await expect(conversationList(page).row('À supprimer')).toHaveCount(0);
  await expect(chat(page).userMessages).toHaveCount(0);
});

const MODELS = { 'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 } };

test('the header says where the conversation’s memory is', async ({ launch }) => {
  const { page } = await launch({ managed: { models: MODELS } });
  await page.getByRole('button', { name: 'Démarrer' }).click();
  await expect(chat(page).composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });
  await ask(page, 'Première question');
  await expect(page.locator('.conversation-header').getByText('Contexte dans le moteur')).toBeVisible();
});
