/**
 * The four modes, end to end, from the switch in the composer's toolbar:
 * Lecture refuses a write without asking anything; « Autoriser et passer en
 * Plume » lets the next write pass, while a command still asks; in Impro a
 * file that runs later (package.json) is asked about all the same, and
 * nothing is written before « Autoriser ».
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const edit = (path: string, from: string, to: string) =>
  `<|tool_call>call:edit_file{path:${Q}${path}${Q},old_string:${Q}${from}${Q},new_string:${Q}${to}${Q}}<tool_call|>`;
const RUN = `<|tool_call>call:run_command{program:${Q}node${Q},args:[${Q}--version${Q}]}<tool_call|>`;

/** The model: a call chosen by a word of the last message; « Fait. » once it has read a result; « ok » otherwise. */
function model(prompt: string): string {
  const user = prompt.lastIndexOf('<|turn>user');
  if (prompt.lastIndexOf('<|tool_response>') > user) return 'Fait.';
  const asked = prompt.slice(user);
  if (asked.includes('paquet')) return edit('package.json', '"name": "a"', '"name": "b"');
  if (asked.includes('encore')) return edit('notes.txt', 'second', 'third');
  if (asked.includes('note')) return edit('notes.txt', 'first', 'second');
  if (asked.includes('teste')) return RUN;
  return 'ok';
}

const card = (page: Page) => page.getByRole('region', { name: 'Demande d’accord' });

async function choose(page: Page, mode: 'Lecture' | 'Répétition' | 'Plume' | 'Impro'): Promise<void> {
  await page.locator('aparte-approval-mode').getByRole('combobox').click();
  await page.getByRole('option', { name: mode }).click();
}

async function answered(page: Page, text: string): Promise<void> {
  const ui = chat(page);
  const before = await ui.replies.count();
  await ui.send(text);
  await expect(ui.replies).toHaveCount(before + 1);
}

test('Lecture: a write is refused without asking anything', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: model } });
  await writeFile(join(home, 'notes.txt'), 'first\n');
  await answered(page, 'Bonjour');
  await choose(page, 'Lecture');
  await answered(page, 'Change la note');
  await expect(chat(page).replyText).toHaveText('Fait.', { timeout: 15_000 });
  await expect(card(page)).toHaveCount(0);
  expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('first\n');
});

test('« Autoriser et passer en Plume »: the next write passes, a command still asks', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: model } });
  await writeFile(join(home, 'notes.txt'), 'first\n');
  await answered(page, 'Change la note');
  await card(page).getByRole('button', { name: 'Autoriser et passer en Plume' }).click();
  await expect.poll(() => readFile(join(home, 'notes.txt'), 'utf8'), { timeout: 15_000 }).toBe('second\n');

  await answered(page, 'Change encore la note');
  await expect.poll(() => readFile(join(home, 'notes.txt'), 'utf8'), { timeout: 15_000 }).toBe('third\n');
  await expect(card(page)).toHaveCount(0);

  await answered(page, 'Lance, teste');
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await expect(card(page)).toContainText('Lancer');
  await expect(card(page)).toContainText('node --version');
});

test('Impro: a file that runs later is asked about all the same, and nothing is written before « Autoriser »', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: model } });
  await writeFile(join(home, 'package.json'), '{ "name": "a" }\n');
  await writeFile(join(home, 'notes.txt'), 'first\n');
  await answered(page, 'Bonjour');
  await choose(page, 'Impro');
  // An ordinary file passes without asking anything…
  await answered(page, 'Change la note');
  await expect.poll(() => readFile(join(home, 'notes.txt'), 'utf8'), { timeout: 15_000 }).toBe('second\n');
  await expect(card(page)).toHaveCount(0);
  // …a file that runs later is asked about.
  await answered(page, 'Change le paquet');
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await expect(card(page)).toContainText('package.json');
  expect(await readFile(join(home, 'package.json'), 'utf8')).toBe('{ "name": "a" }\n');
  await card(page).getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect.poll(() => readFile(join(home, 'package.json'), 'utf8'), { timeout: 15_000 }).toBe('{ "name": "b" }\n');
});

test('a mode chosen before the first message holds: the new conversation runs in it, and the switch keeps showing it', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: model } });
  await writeFile(join(home, 'notes.txt'), 'first\n');
  await choose(page, 'Lecture');
  await answered(page, 'Change la note');
  await expect(chat(page).replyText).toHaveText('Fait.', { timeout: 15_000 });
  await expect(card(page)).toHaveCount(0);
  expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('first\n');
  await expect(chat(page).modeShown).toHaveText('Lecture');
});

test('going back to a conversation shows its own mode, even one born in this window', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: model } });
  await choose(page, 'Lecture');
  await answered(page, 'Premier sujet');
  await page.getByRole('button', { name: 'Nouvelle conversation' }).click();
  await choose(page, 'Plume');
  await answered(page, 'Second sujet');
  await expect(chat(page).modeShown).toHaveText('Plume');

  await page.locator('aparte-conversation-list').getByRole('button', { name: /Premier sujet/ }).click();
  await expect(chat(page).modeShown).toHaveText('Lecture');
  await page.locator('aparte-conversation-list').getByRole('button', { name: /Second sujet/ }).click();
  await expect(chat(page).modeShown).toHaveText('Plume');
});
