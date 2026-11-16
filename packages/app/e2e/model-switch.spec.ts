/**
 * Changing model mid-conversation, end to end (task 7.4; board « Coûts
 * annoncés », 3). The model is chosen in the composer, with aparté's model
 * selector; picking another says what it costs before anything is paid —
 * the reload, the re-reading, the video memory now and after — in a dialog:
 * « Annuler » changes nothing, « Changer » loads it and the conversation goes
 * on in its family, « Brancher sur ce modèle » goes on in a new conversation.
 */

import { FAKE_QWEN_TEMPLATE } from '@aparte/bonaparte-core/testing';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';
import { conversationList } from './fixtures/conversations.js';

const MODELS = {
  'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 },
  'qwen-e2e': { architecture: 'qwen3', chatTemplate: FAKE_QWEN_TEMPLATE, paddingBytes: 1024 * 1024 },
};

async function started(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Démarrer' }).click();
  const ui = chat(page);
  await expect(ui.composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });
  await ui.send('Bonjour');
  await expect(ui.replies).toHaveCount(1);
  await expect(ui.streamingReplies).toHaveCount(0);
}

const picker = (page: Page) => page.getByRole('combobox', { name: 'Modèle' });

async function pick(page: Page, name: string): Promise<void> {
  await picker(page).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
}

async function loaded(page: Page): Promise<string | undefined> {
  return page.evaluate(async () => {
    const preload = window as unknown as { bonaparte: { invoke(name: string, input: unknown): Promise<{ model?: { name: string } }> } };
    return (await preload.bonaparte.invoke('engine.state', undefined)).model?.name;
  });
}

test('picking another model says its cost first; « Annuler » changes nothing', async ({ launch }) => {
  const { page } = await launch({ managed: { models: MODELS } });
  await started(page);
  await expect(picker(page)).toContainText('gemma-4-e2e');

  await pick(page, 'qwen-e2e');
  const dialog = page.getByRole('dialog', { name: 'Passer à qwen-e2e ?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Recharger le moteur');
  // The thousands grouped as French groups them: a narrow no-break space.
  await expect(dialog).toContainText(/Relire [\d\s ]+ jetons/);
  await expect(dialog).toContainText(/Mémoire vidéo[\s\S]*au lieu de/);
  await expect(dialog).toContainText('La mémoire actuelle reste sauvée pour gemma-4-e2e.');
  await expect(dialog.getByRole('button', { name: 'Brancher sur ce modèle' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toBeHidden();
  await expect(picker(page)).toContainText('gemma-4-e2e');
  expect(await loaded(page)).toBe('gemma-4-e2e');
});

test('a model picked through « /model » says its cost first, as one picked in the list (check of aparté 1.12)', async ({ launch }) => {
  const { page } = await launch({ managed: { models: MODELS } });
  await started(page);
  await chat(page).editor.click();
  await page.keyboard.type('/');
  const list = page.getByRole('listbox');
  await list.getByRole('option', { name: /^\/model/ }).click();
  await page.getByRole('listbox').getByRole('option', { name: /qwen-e2e/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Passer à qwen-e2e ?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(picker(page)).toContainText('gemma-4-e2e');
  expect(await loaded(page)).toBe('gemma-4-e2e');
});

test('« Changer » loads it, and the conversation goes on in its family', async ({ launch }) => {
  const { page, engineRequests } = await launch({ managed: { models: MODELS } });
  await started(page);

  await pick(page, 'qwen-e2e');
  const dialog = page.getByRole('dialog', { name: 'Passer à qwen-e2e ?' });
  await dialog.getByRole('button', { name: 'Changer' }).click();
  // Done, the dialog closes — and stays closed: the picker following the engine is no new pick.
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect.poll(() => loaded(page), { timeout: 20_000 }).toBe('qwen-e2e');
  await expect(picker(page)).toContainText('qwen-e2e');
  await page.waitForTimeout(500);
  await expect(dialog).toBeHidden();

  const ui = chat(page);
  await ui.send('Et en Qwen ?');
  await expect(ui.replies).toHaveCount(2);
  await expect(ui.streamingReplies).toHaveCount(0);
  const answered = (await engineRequests()).filter((request) => request.nPredict !== 0);
  expect(answered.at(-1)!.opens.startsWith('<|im_start|>system')).toBe(true);
  // No error, and the thread is the conversation's, both answers in it.
  await expect(ui.errors).toHaveCount(0);
  await expect(ui.userMessages).toHaveCount(2);
});

test('« Brancher sur ce modèle » goes on in a new conversation; the original is kept', async ({ launch }) => {
  const { page } = await launch({ managed: { models: MODELS } });
  await started(page);
  const conversations = conversationList(page).list.locator('[data-conv-id]');
  await expect(conversations).toHaveCount(1);

  await pick(page, 'qwen-e2e');
  await page.getByRole('dialog', { name: 'Passer à qwen-e2e ?' }).getByRole('button', { name: 'Brancher sur ce modèle' }).click();
  await expect.poll(() => loaded(page), { timeout: 20_000 }).toBe('qwen-e2e');
  await expect(conversations).toHaveCount(2);
  // The copy is shown, with the thread it started from.
  const ui = chat(page);
  await expect(ui.userMessages).toHaveCount(1);
  await expect(ui.userMessages.first()).toContainText('Bonjour');
});

test('« Brancher sur ce modèle »: the original, opened again, says its re-reading for the model that runs (review of phase 7)', async ({ launch }) => {
  const { page } = await launch({ managed: { models: MODELS } });
  await started(page);
  await pick(page, 'qwen-e2e');
  await page.getByRole('dialog', { name: 'Passer à qwen-e2e ?' }).getByRole('button', { name: 'Brancher sur ce modèle' }).click();
  await expect.poll(() => loaded(page), { timeout: 20_000 }).toBe('qwen-e2e');
  const rows = conversationList(page).list.locator('[data-conv-id]');
  await expect(rows).toHaveCount(2);
  // The newest is the copy, shown; the original is the other one.
  await rows.nth(1).click();
  await expect(page.locator('.memory-banner')).toContainText('autre modèle', { timeout: 10_000 });
});

