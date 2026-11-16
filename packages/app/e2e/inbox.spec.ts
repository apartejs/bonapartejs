/**
 * « À traiter » (task 8.4, board « À traiter »): Ctrl J opens a page of what
 * waits for the person across the conversations, the sidebar counts it; an
 * approval is answered from there and the reply goes on; a question opens its
 * conversation (aparté cannot answer it from outside, apartejs/aparte#250).
 * A reply finished while the person looked elsewhere is « Pas encore lu »:
 * a blue dot on its row, a row at the bottom of the page, until it is opened.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const EDIT = `<|tool_call>call:edit_file{path:${Q}notes.txt${Q},old_string:${Q}old line${Q},new_string:${Q}new line${Q}}<tool_call|>`;
const ASK = `<|tool_call>call:ask_user{question:${Q}Une date vide : je la garde vide ?${Q}}<tool_call|>`;

/** Edits the note when asked about it, asks a question when asked about dates; « Fait. » once it has read a result. */
function model(prompt: string): string {
  const user = prompt.lastIndexOf('<|turn>user');
  if (prompt.lastIndexOf('<|tool_response>') > user) return 'Fait.';
  const asked = prompt.slice(user);
  if (asked.includes('note')) return EDIT;
  if (asked.includes('date')) return ASK;
  return 'ok';
}

function page$(page: Page) {
  return page.getByRole('region', { name: 'À traiter', exact: true });
}

test('Ctrl J opens « À traiter », the sidebar counts it; an approval answered there lets the reply go on', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: model } });
  await writeFile(join(home, 'notes.txt'), 'old line\n');
  const ui = chat(page);
  await ui.send('Change la note');
  await expect(page.getByRole('region', { name: 'Demande d’accord' })).toBeVisible({ timeout: 15_000 });
  // The person goes elsewhere: a new conversation.
  await page.getByRole('button', { name: 'Nouvelle conversation' }).first().click();
  await expect(page.getByRole('button', { name: '1 à traiter' })).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press('Control+j');
  const inbox = page$(page);
  await expect(inbox).toBeVisible();
  // The panes belong to the conversation: they give way to the page, and come back with it.
  await expect(page.locator('.bonaparte-panes')).toBeHidden();
  // The keyboard goes to the page, not to the button the person left behind.
  await expect(inbox).toBeFocused();
  const card = inbox.getByRole('article', { name: /^Demande d’accord · Change la note/ });
  await expect(card).toContainText('notes.txt');
  await card.getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect.poll(() => readFile(join(home, 'notes.txt'), 'utf8'), { timeout: 15_000 }).toBe('new line\n');
  await expect(card).toHaveCount(0, { timeout: 10_000 });
  await expect(inbox).toContainText('Rien n’attend ta décision.');
  await expect(page.getByRole('button', { name: 'À traiter', exact: true })).toBeVisible();
});

test('an approval that waits while the engine is unloaded: the page says so and opens its conversation — no « Autoriser » to lose (review of phase 8)', async ({ launch }) => {
  const { page, home } = await launch({ managed: { models: { 'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 } } }, env: { FAKE_LLAMA_ANSWER: EDIT } });
  await writeFile(join(home, 'notes.txt'), 'old line\n');
  await page.getByRole('button', { name: 'Démarrer' }).click();
  const ui = chat(page);
  await expect(ui.composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });
  await ui.send('Change la note');
  await expect(page.getByRole('region', { name: 'Demande d’accord' })).toBeVisible({ timeout: 15_000 });
  // The engine let go meanwhile (« Décharger », or fifteen minutes without work).
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  const settings = page.getByRole('navigation', { name: 'Réglages' });
  await settings.getByRole('link', { name: 'Moteur et mémoire' }).click();
  await page.getByRole('button', { name: 'Décharger' }).click();
  await expect(page.getByRole('region', { name: 'Moteur', exact: true })).toContainText('Déchargé', { timeout: 15_000 });
  await settings.getByRole('link', { name: 'Conversations' }).click();

  await page.keyboard.press('Control+j');
  const card = page$(page).getByRole('article', { name: /^Demande d’accord · Change la note/ });
  await expect(card).toContainText('Le moteur est déchargé');
  await expect(card.getByRole('button', { name: 'Autoriser', exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: 'Ouvrir la conversation' }).click();
  await expect(page.locator('.engine-unloaded')).toBeVisible();
  expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('old line\n');
});

test('a question waits on the page; « Répondre » opens its conversation, where it waits in the composer', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: model } });
  const ui = chat(page);
  await ui.send('Une question de date');
  await expect(ui.question).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Nouvelle conversation' }).first().click();
  await page.keyboard.press('Control+j');
  const card = page$(page).getByRole('article', { name: /^Question/ });
  await expect(card).toContainText('Une date vide : je la garde vide ?');
  await card.getByRole('button', { name: 'Répondre' }).click();
  await expect(page$(page)).toHaveCount(0);
  await expect(ui.question).toBeVisible();
});

test('a reply finished while the person looked elsewhere is « Pas encore lu », until it is opened', async ({ launch }) => {
  // A reply that takes a while: the person leaves before it ends.
  const { page } = await launch({ engine: { responder: () => 'La synthèse est prête.', paceMs: 120 } });
  const ui = chat(page);
  await ui.send('Fais la synthèse');
  await page.getByRole('button', { name: 'Nouvelle conversation' }).first().click();
  const row = page.locator('aparte-conversation-list').getByRole('img', { name: 'Pas encore lu' });
  await expect(row).toBeVisible({ timeout: 20_000 });

  await page.keyboard.press('Control+j');
  const unread = page$(page).getByRole('region', { name: 'Fini, pas encore lu' });
  await expect(unread).toContainText('Fais la synthèse');
  await expect(unread).toContainText('La synthèse est prête.');
  await unread.getByRole('button', { name: /Fais la synthèse/ }).click();
  await expect(ui.replyText).toHaveText('La synthèse est prête.');
  await expect(row).toHaveCount(0, { timeout: 10_000 });
});
