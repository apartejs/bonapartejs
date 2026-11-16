/**
 * The costs said before they are paid (task 7.4; board « Coûts annoncés »),
 * the moments 7.4 brings to the screen. The restore, the re-reading and the
 * context nearly full are pinned by their own specs (kv-restore, reread,
 * compaction); changing model by model-switch.spec.
 *
 * 5 · The engine unloaded: the conversation stays, and a card says the model
 * and what loading it costs. A message sent meanwhile waits in the composer,
 * nothing asked of the engine, until « Charger et envoyer ». At launch, a
 * model known: the conversations, and nothing loaded before the click.
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

async function unload(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  const settings = page.getByRole('navigation', { name: 'Réglages' });
  await settings.getByRole('link', { name: 'Moteur et mémoire' }).click();
  await page.getByRole('button', { name: 'Décharger' }).click();
  await expect(page.getByRole('region', { name: 'Moteur', exact: true })).toContainText('Déchargé', { timeout: 15_000 });
  await settings.getByRole('link', { name: 'Conversations' }).click();
}

const card = (page: Page) => page.locator('.engine-unloaded');

test('unloaded, the conversation stays: the card says what loading costs, and a message waits for « Charger et envoyer »', async ({ launch }) => {
  const { page, engineRequests } = await launch({ managed: { models: MODELS } });
  await page.getByRole('button', { name: 'Démarrer' }).click();
  const ui = chat(page);
  await expect(ui.composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });
  await ask(page, 'Bonjour');
  await unload(page);

  await expect(card(page)).toContainText('gemma-4-e2e est déchargé');
  await expect(card(page)).toContainText(/Le charger prend ~[\d,]+ s et [\d,]+ [GM]o de mémoire vidéo\./);
  await expect(card(page)).toContainText(/Déchargé à \d\d:\d\d\./);
  await expect(ui.userMessages).toHaveCount(1);

  // Sent while nothing runs: held — not in the thread, still in the composer, nothing asked of the engine.
  const before = (await engineRequests()).length;
  await ui.send('Encore une question');
  await expect(card(page)).toContainText('Ton message est gardé');
  await expect(ui.userMessages).toHaveCount(1);
  await expect(ui.composerBox).toContainText('Encore une question');
  expect((await engineRequests()).length).toBe(before);

  await card(page).getByRole('button', { name: 'Charger et envoyer' }).click();
  await expect(ui.userMessages).toHaveCount(2, { timeout: 20_000 });
  await expect(ui.userMessages.nth(1)).toContainText('Encore une question');
  await expect(ui.replies).toHaveCount(2, { timeout: 15_000 });
  await expect(card(page)).toBeHidden();
  await expect(ui.errors).toHaveCount(0);
});

test('at launch, a model known: the conversations are there, and nothing is loaded before the click', async ({ launch }) => {
  const first = await launch({ managed: { models: MODELS }, keepData: true });
  await first.page.getByRole('button', { name: 'Démarrer' }).click();
  await expect(chat(first.page).composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });
  await ask(first.page, 'Bonjour');
  const main = first.app.process();
  const exited = new Promise<void>((resolve) => main.once('exit', () => resolve()));
  await first.app.evaluate(({ app }) => app.quit()).catch(() => undefined);
  await exited;
  await first.close();

  const second = await launch({ managed: { models: MODELS }, dataDir: first.dataDir });
  await expect(card(second.page)).toContainText('gemma-4-e2e est déchargé', { timeout: 15_000 });
  await expect(second.page.getByRole('heading', { name: 'Préparons le moteur' })).toHaveCount(0);
  const state = await second.page.evaluate(() => {
    const preload = window as unknown as { bonaparte: { invoke(name: string, input: unknown): Promise<unknown> } };
    return preload.bonaparte.invoke('engine.state', undefined);
  });
  expect(state).toMatchObject({ status: 'stopped', resume: { name: 'gemma-4-e2e' } });
  // The engine's log is the data folder's: what the first launch asked, and nothing more since.
  const asked = (await second.engineRequests()).length;
  await second.page.waitForTimeout(500);
  expect(await second.engineRequests()).toHaveLength(asked);

  // « Charger et envoyer » with nothing written: the model loads, and the conversation goes on.
  await card(second.page).getByRole('button', { name: 'Charger et envoyer' }).click();
  await expect(card(second.page)).toBeHidden({ timeout: 20_000 });
  await ask(second.page, 'Me revoilà');
});
