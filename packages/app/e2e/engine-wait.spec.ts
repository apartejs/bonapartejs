/**
 * Several conversations on the built-in engine (audit C1, C2). With one slot,
 * a turn keeps it while its tools run: a conversation that waits for it says
 * who holds it and what it does, its row says it waits for the engine (not
 * « en cours »), and the engine's card says who works. With two slots
 * (« Slots du moteur : 2 »), two conversations answer at the same time.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const answered = (prompt: string) => prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user');
/** A command that lasts a few seconds: what « the tests » are here. */
const RUN_TESTS = `<|tool_call>call:run_command{program:${Q}${process.execPath}${Q},args:[${Q}-e${Q},${Q}setTimeout(()=>{},6000)${Q}]}<tool_call|>`;

async function newConversation(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nouvelle conversation', exact: true }).first().click();
}

const queued = (page: Page) => page.getByRole('img', { name: 'attend le moteur' });

test('a conversation that waits for the engine says who holds it and what it does; its row says it waits; the card says who works (audit C1)', async ({ launch }) => {
  test.setTimeout(90_000);
  const { page } = await launch({
    engine: { responder: (prompt) => (prompt.includes('Lance les tests') && !answered(prompt) ? RUN_TESTS : 'Fait.') },
  });
  const ui = chat(page);
  // In Impro the command passes, and runs in the slot its turn holds (an approved call runs before the turn takes
  // the slot again: nobody waits for it).
  await page.locator('aparte-approval-mode').getByRole('combobox').click();
  await page.getByRole('option', { name: 'Impro' }).click();
  await ui.send('Lance les tests');
  // The card says who works.
  await expect(page.locator('.engine-card__line')).toHaveText(/^Occupé : « .+ »$/, { timeout: 10_000 });

  await newConversation(page);
  await chat(page).send('Et toi ?');
  // The waiting reply says who holds the engine, and what it does — what a screen reader hears.
  await expect(page.locator('[aria-live]', { hasText: /^Attend le moteur : « .+ » lance node(\.exe)? -e setTimeout/ })).toHaveCount(1, {
    timeout: 10_000,
  });
  // Its row says it waits for the engine; the conversation that works does not.
  await expect(queued(page)).toHaveCount(1);
  await expect(page.locator('.aparte-conv-item', { has: queued(page) })).toHaveAttribute('data-status', 'running');

  // The command done, the first ends; then the second answers, and no row waits any more.
  await expect(chat(page).replyText).toHaveText('Fait.', { timeout: 30_000 });
  await expect(queued(page)).toHaveCount(0);
  await expect(page.locator('.engine-card__line')).toHaveText(/^Prêt/, { timeout: 10_000 });
});

test('with two slots (« Slots du moteur : 2 »), two conversations answer at the same time (audit C2)', async ({ launch }) => {
  test.setTimeout(120_000);
  // A reply that lasts: 200 words, one every 60 ms — some 12 s.
  const { page } = await launch({
    managed: { models: { 'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 } } },
    settings: { subagentsOnBuiltin: 'parallel' },
    env: { FAKE_LLAMA_PACE_MS: '60', FAKE_LLAMA_ANSWER: 'mot '.repeat(200).trim() },
  });
  await page.getByRole('button', { name: 'Démarrer' }).click();
  const ui = chat(page);
  await expect(ui.composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.engine-card__line')).toHaveText(/· 2 slots$/, { timeout: 20_000 });

  await ui.send('Premier');
  await expect(ui.streamingReplies).toHaveCount(1, { timeout: 15_000 });
  await newConversation(page);
  await chat(page).send('Second');
  // The second writes while the first still does: neither waits for the engine.
  await expect(chat(page).replyText).toContainText('mot mot', { timeout: 8_000 });
  await expect(page.locator('.aparte-conv-item[data-status="running"]')).toHaveCount(2);
  await expect(queued(page)).toHaveCount(0);
  await expect(page.locator('.engine-card__line')).toHaveText(/^Occupé : « .+ » et 1 autre$/);
});
