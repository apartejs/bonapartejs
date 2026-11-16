/**
 * The memory of a conversation, end to end, on a managed engine (the fake
 * binary): reopening one whose memory was saved says so — its tokens, its
 * time, nothing to choose; one whose memory was let go says what reading it
 * again costs, and nothing is read before the person goes on; while it is
 * read again, the chat says the step in the language of the app and a bar
 * follows the engine's progress. Closing the app keeps the memory: after a
 * restart, the same conversation resumes from it.
 */

import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test, type LaunchedApp } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const MODELS = { 'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 } };

/** A first message long enough that reading it again takes several steps of the engine. */
const LONG = `Première question : ${'un mot de plus '.repeat(160)}`.trim();
const FIRST = /^Première question/;

/** Loads the model on « Démarrer » and waits for the conversations. */
async function startEngine(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Démarrer' }).click();
  await expect(chat(page).composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });
}

async function ask(page: Page, text: string): Promise<void> {
  const ui = chat(page);
  const before = await ui.replies.count();
  await ui.send(text);
  await expect(ui.replies).toHaveCount(before + 1, { timeout: 15_000 });
  await expect(ui.streamingReplies).toHaveCount(0, { timeout: 15_000 });
  await expect(ui.replyText).toHaveText('ok');
}

async function newConversation(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nouvelle conversation' }).click();
  await expect(chat(page).userMessages).toHaveCount(0);
}

async function openConversation(page: Page, title: RegExp): Promise<void> {
  await page.locator('aparte-conversation-list').getByRole('button', { name: title }).click();
  await expect(chat(page).userMessages.first()).toBeVisible();
}

/** Two conversations, the long one first: the second takes the slot, and the first is saved as it leaves. */
async function twoConversations(page: Page): Promise<void> {
  await ask(page, LONG);
  await newConversation(page);
  await ask(page, 'Une autre question');
}

/**
 * The saved states of the conversations, gone as the disk budget lets them go:
 * each leaves the note the core's retention writes (when, under which budget).
 * The seeds stay.
 */
async function letMemoriesGo(launched: LaunchedApp): Promise<void> {
  const dir = join(launched.dataDir, 'kv-slots');
  const states = (await readdir(dir)).filter((name) => name.endsWith('.slot') && !name.startsWith('seed-'));
  expect(states.length).toBeGreaterThan(0);
  for (const name of states) {
    const id = name.slice(0, -'.slot'.length);
    await rm(join(dir, name), { force: true });
    await rm(join(dir, `${id}.manifest.json`), { force: true });
    await writeFile(join(dir, `${id}.evicted.json`), JSON.stringify({ at: new Date().toISOString(), budgetBytes: 20 * 1024 ** 3 }));
  }
}

test('reopening a conversation whose memory was saved says so, with nothing to choose', async ({ launch }) => {
  const { page } = await launch({ managed: { models: MODELS } });
  await startEngine(page);
  await twoConversations(page);

  await openConversation(page, FIRST);
  const banner = page.locator('.memory-banner');
  await expect(banner).toContainText(/Mémoire sauvée\s:\s[\d\s]+jetons/);
  await expect(banner).toContainText(/Reprise en ~.+ au lieu de ~.+ de relecture\./);
  await expect(banner).toContainText(/Sauvée le \d\d\/\d\d à \d\d:\d\d · .+ sur disque/);
  await expect(banner.getByRole('button')).toHaveCount(0);
  // It sits above the composer, on its axis.
  const [box, composer] = await Promise.all([banner.boundingBox(), chat(page).composerBox.boundingBox()]);
  expect(Math.round(box!.x)).toBe(Math.round(composer!.x));
  expect(Math.round(box!.width)).toBe(Math.round(composer!.width));

  // The conversation goes on from its memory: nothing is read again, and the cost said is paid.
  await ask(page, 'Et ensuite ?');
  await expect(page.getByText('Relit la conversation')).toHaveCount(0);
  await expect(banner).toHaveCount(0);
});

test('a memory let go says what reading again costs, and nothing is read before the person goes on', async ({ launch }) => {
  const launched = await launch({
    managed: { models: MODELS },
    // The engine reads 16 tokens at a time, 80 ms a step: a re-read the page can watch.
    env: { FAKE_LLAMA_PREFILL_BATCH: '16', FAKE_LLAMA_PREFILL_PACE_MS: '80' },
  });
  const { page } = launched;
  await startEngine(page);
  await twoConversations(page);
  await letMemoriesGo(launched);
  const asked = (await launched.engineRequests()).length;

  await openConversation(page, FIRST);
  const banner = page.locator('.memory-banner');
  await expect(banner).toContainText(/À relire\s:\s[\d\s]+jetons, ~/);
  await expect(banner).toContainText(/Sa mémoire a été libérée le \d\d\/\d\d pour rester sous les 20 Go\./);
  const goOn = banner.getByRole('button', { name: 'Relire et continuer' });
  await expect(goOn).toBeVisible();

  // Nothing was asked of the engine: not by opening, not in the second that followed.
  await page.waitForTimeout(1_000);
  expect((await launched.engineRequests()).length).toBe(asked);

  await goOn.click();
  await expect(banner).toHaveCount(0);

  // The next message reads the conversation again: the step is said, the bar follows the engine.
  const ui = chat(page);
  await ui.send('Et maintenant ?');
  // The step, in the app's language: what a screen reader hears; on the screen, the bar takes its place.
  await expect(page.locator('[aria-live]', { hasText: 'Relit la conversation' })).toHaveCount(1, { timeout: 10_000 });
  const bar = page.locator('.reread-progress');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(/Relu\s:\s[\d\s]+sur [\d\s]+jetons/);
  await expect(ui.streamingReplies).toHaveCount(0, { timeout: 20_000 });
  await expect(ui.replyText).toHaveText('ok');

  // What was read again is the whole conversation, the long message with it.
  const last = (await launched.engineRequests()).at(-1)!;
  expect(last.promptChars).toBeGreaterThan(LONG.length);
});

test('the gauge shows the tokens the engine counted, not an estimate', async ({ launch }) => {
  const launched = await launch({ managed: { models: MODELS } });
  const { page } = launched;
  await startEngine(page);
  await ask(page, LONG);

  const gauge = page.locator('aparte-context');
  await expect.poll(() => gauge.evaluate((element) => (element as unknown as { used: number | null }).used)).not.toBeNull();
  const used = await gauge.evaluate((element) => (element as unknown as { used: number }).used);
  // What the engine holds after the turn: the prompt as it counted it, and its answer « ok » (one token).
  // bonaparte's own estimate (three characters to a token) would say more.
  const last = (await launched.engineRequests()).at(-1)!;
  expect(used).toBe(last.promptTokens + 1);
  expect(used).not.toBe(Math.ceil(last.promptChars / 3) + 8);
});

test('a conversation closed with the app comes back as it was, and resumes from its memory', async ({ launch }) => {
  const first = await launch({ managed: { models: MODELS }, keepData: true });
  await startEngine(first.page);
  await ask(first.page, LONG);
  const saved = await documents(first.page);

  // Quit as the person does: the app saves the memory of the conversation in the engine.
  const main = first.app.process();
  const exited = new Promise<void>((resolve) => main.once('exit', () => resolve()));
  await first.app.evaluate(({ app }) => app.quit()).catch(() => undefined);
  await exited;
  await first.close();

  const second = await launch({ managed: { models: MODELS }, dataDir: first.dataDir });
  // The document the page saved reads back the same, before anything is done with it.
  expect(await documents(second.page)).toEqual(saved);
  // A model known (task 7.4): the conversations are there, and the card loads it again.
  await second.page.locator('.engine-unloaded').getByRole('button', { name: 'Charger et envoyer' }).click();
  await expect(second.page.locator('.engine-unloaded')).toBeHidden({ timeout: 20_000 });
  await openConversation(second.page, FIRST);
  await expect(chat(second.page).userMessages).toHaveCount(1);
  await expect(chat(second.page).userMessages.first()).toContainText(LONG);
  await expect(chat(second.page).replyText).toHaveText('ok');
  await expect(second.page.locator('.memory-banner')).toContainText(/Mémoire sauvée\s:\s[\d\s]+jetons/);
});

/** Every conversation the core keeps for the page, as the page will load them. */
async function documents(page: Page): Promise<unknown[]> {
  return page.evaluate(async () => {
    const preload = window as unknown as { bonaparte: { invoke(name: string, input?: unknown): Promise<unknown> } };
    const all = (await preload.bonaparte.invoke('conversations.loadAll')) as { id: string }[];
    return Promise.all(all.map((one) => preload.bonaparte.invoke('conversations.loadFull', { id: one.id })));
  });
}
