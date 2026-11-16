/**
 * Compaction (board « Coûts annoncés », 4; task 7.3): the context nearly
 * full is said before a reply is cut — « Contexte plein à N % », with
 * « Compacter » and its duration, or « Continuer quand même »; « / compact »
 * asks it too. The model summarises; aparté's checkpoint marks it in the
 * thread; the next turn reads the summary, not the early turns. « Restaurer »
 * goes on from before it. Too short to be worth it: said, nothing changed.
 */

import { expect, test, type LaunchedApp, type LaunchOptions } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const LONG = 'Une longue réponse sur le travail fait. '.repeat(110);

/** The model: a summary when asked for one, a long answer otherwise. */
function model(prompt: string): string {
  if (prompt.includes('Summarize this conversation so far')) return 'RÉSUMÉ DU TRAVAIL.';
  if (prompt.slice(prompt.lastIndexOf('<|turn>user')).includes('Et ensuite')) return 'Suite.';
  return LONG;
}

/** An answer that brings the conversation to 92 % of a window of `nCtx`, as the engine counts it (the fake one: four characters a token). */
function filling(nCtx: number) {
  return (prompt: string): string => {
    if (prompt.includes('Summarize this conversation so far')) return 'RÉSUMÉ DU TRAVAIL.';
    if (prompt.slice(prompt.lastIndexOf('<|turn>user')).includes('Et ensuite')) return 'Suite.';
    const room = Math.floor(0.92 * nCtx - Math.ceil(prompt.length / 4));
    return 'Une longue réponse sur le travail fait. '.repeat(Math.max(1, Math.floor((room * 4) / 40)));
  };
}

async function longConversation(launch: (options?: LaunchOptions) => Promise<LaunchedApp>, turns: number, nCtx = 32_768) {
  const prompts: string[] = [];
  const responder = nCtx < 32_768 ? filling(nCtx) : model;
  const launched = await launch({ engine: { responder, nCtx, onCompletion: (body) => prompts.push(String(body['prompt'])) } });
  for (let turn = 1; turn <= turns; turn += 1) {
    await chat(launched.page).send(`Message numéro ${turn}.`);
    await expect(chat(launched.page).replyText).toContainText('Une longue réponse', { timeout: 15_000 });
    await expect(chat(launched.page).userMessages).toHaveCount(turn);
  }
  return { ...launched, prompts };
}

async function command(page: LaunchedApp['page'], name: RegExp) {
  await chat(page).editor.click();
  await page.keyboard.type('/');
  await page.getByRole('listbox').getByRole('option', { name }).click();
}

test('the context nearly full is said; « Compacter » summarises, the thread marks it, the next turn reads the summary', async ({ launch }) => {
  const { page, prompts } = await longConversation(launch, 1, 8000);
  const banner = page.getByRole('status').filter({ hasText: /Contexte plein à \d+ %/ });
  await expect(banner).toBeVisible({ timeout: 10_000 });
  // Its figure is the gauge's: what the engine counted, not an estimate beside it.
  const used = await page.locator('aparte-context').evaluate((element) => (element as unknown as { used: number }).used);
  const said = /([\d\s  ]+) \//.exec((await banner.textContent()) ?? '')?.[1] ?? '';
  expect(Number(said.replace(/\D/g, ''))).toBe(used);
  await banner.getByRole('button', { name: /^Compacter · / }).click();
  await expect(page.locator('.bonaparte-live-chat:not([hidden])').getByText(/messages résumés pour le modèle/)).toBeVisible({ timeout: 15_000 });
  await expect(banner).toHaveCount(0);

  await chat(page).send('Et ensuite ?');
  await expect(chat(page).replyText).toHaveText('Suite.', { timeout: 15_000 });
  expect(prompts.at(-1)).toContain('RÉSUMÉ DU TRAVAIL.');
  expect(prompts.at(-1)).not.toContain('Une longue réponse');
});

test('« Continuer quand même » sets the banner aside', async ({ launch }) => {
  const { page } = await longConversation(launch, 1, 8000);
  const banner = page.getByRole('status').filter({ hasText: /Contexte plein à \d+ %/ });
  await banner.getByRole('button', { name: 'Continuer quand même' }).click();
  await expect(banner).toHaveCount(0);
});

test('« / compact » asks it; « Restaurer » goes on from before it', async ({ launch }) => {
  const { page, prompts } = await longConversation(launch, 3, 32_768);
  await command(page, /^\/compact/);
  const live = page.locator('.bonaparte-live-chat:not([hidden])');
  await expect(live.getByText(/messages résumés pour le modèle/)).toBeVisible({ timeout: 15_000 });

  await live.getByRole('button', { name: 'Restaurer' }).click();
  await live.getByRole('button', { name: 'Restaurer' }).click();
  await expect(live.getByText(/messages résumés pour le modèle/)).toHaveCount(0);
  await chat(page).send('Et ensuite ?');
  await expect(chat(page).replyText).toHaveText('Suite.', { timeout: 15_000 });
  expect(prompts.at(-1)).toContain('Message numéro 1.');
});

test('a conversation too short to be worth it: said, nothing changed', async ({ launch }) => {
  const { page } = await longConversation(launch, 1, 32_768);
  await command(page, /^\/compact/);
  await expect(page.getByRole('status').filter({ hasText: 'trop courte' })).toBeVisible({ timeout: 10_000 });
});
