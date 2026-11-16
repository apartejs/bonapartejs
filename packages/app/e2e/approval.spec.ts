/**
 * Approvals, end to end: the core pauses a call it must ask about, the window
 * shows what it would change — the file, the diff — and nothing is written
 * before « Autoriser »; « Refuser… » with a word reaches the model; the mode
 * of the conversation decides what is asked. The app's home folder is a
 * folder of the test: without a project, the tools work there.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const EDIT = `<|tool_call>call:edit_file{path:${Q}notes.txt${Q},old_string:${Q}old line${Q},new_string:${Q}new line${Q}}<tool_call|>`;

/** The model edits notes.txt when asked about the note; it answers « Fait. » once it has read the result. */
function model(call = EDIT) {
  return (prompt: string): string => {
    const user = prompt.lastIndexOf('<|turn>user');
    if (prompt.lastIndexOf('<|tool_response>') > user) return 'Fait.';
    return prompt.slice(user).includes('note') ? call : 'ok';
  };
}

function card(page: Page) {
  return page.getByRole('region', { name: 'Demande d’accord' });
}

test('Répétition: an edit asks, with the file and the diff — written only on « Autoriser »', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: model() } });
  await writeFile(join(home, 'notes.txt'), 'old line\n');
  const ui = chat(page);
  await ui.send('Change la note');

  const request = card(page);
  await expect(request).toBeVisible({ timeout: 15_000 });
  await expect(request).toContainText('Modifier');
  await expect(request).toContainText('notes.txt');
  await expect(request).toContainText('Répétition : chaque écriture est demandée');
  await expect(request.getByText('new line')).toBeVisible();
  expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('old line\n');

  await request.getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect(request).toHaveCount(0);
  await expect(ui.replyText).toHaveText('Fait.', { timeout: 15_000 });
  expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('new line\n');
});

test('« Refuser… » with a word: nothing written, and the model reads it', async ({ launch }) => {
  const prompts: string[] = [];
  const { page, home } = await launch({
    engine: { responder: model(), onCompletion: (body) => prompts.push(String(body['prompt'])) },
  });
  await writeFile(join(home, 'notes.txt'), 'old line\n');
  const ui = chat(page);
  await ui.send('Change la note');

  const request = card(page);
  await request.getByRole('button', { name: 'Refuser…' }).click();
  await request.getByRole('textbox').fill('Garde la note telle quelle.');
  await request.getByRole('button', { name: 'Refuser', exact: true }).click();
  await expect(ui.replyText).toHaveText('Fait.', { timeout: 15_000 });
  expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('old line\n');
  expect(prompts.at(-1)).toContain('Garde la note telle quelle.');
});

test('a person writing elsewhere keeps the keyboard: the card does not take it, their Enter approves nothing (review of phase 8)', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: model(), paceMs: 60 } });
  await writeFile(join(home, 'notes.txt'), 'old line\n');
  const ui = chat(page);
  await ui.send('Change la note');
  // While the model writes its call, the person starts the next message.
  await expect(ui.streamingReplies).toHaveCount(1, { timeout: 10_000 });
  await ui.composerBox.click();
  await page.keyboard.type('Et ensuite');
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await expect(card(page).getByRole('button', { name: 'Autoriser', exact: true })).not.toBeFocused();
  await expect(ui.composerBox).toContainText('Et ensuite');
  await page.waitForTimeout(300);
  expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('old line\n');
});

test('a person typing in their terminal as the card appears keeps it: their Enter runs their line, approves nothing (review of phase 8)', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: model(), paceMs: 60 } });
  await writeFile(join(home, 'notes.txt'), 'old line\n');
  await page.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Terminal', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Terminaux' });
  const first = tabs.getByRole('tab').first();
  await expect(first).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  const output = page.getByRole('log', { name: `Sortie du terminal ${(await first.textContent())!.trim()}` });
  const ui = chat(page);
  await ui.send('Change la note');
  await expect(ui.streamingReplies).toHaveCount(1, { timeout: 10_000 });
  await output.click();
  await page.keyboard.type('echo encore');
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Enter');
  await expect(output).toContainText('encore', { timeout: 20_000 });
  await page.waitForTimeout(300);
  expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('old line\n');
  await expect(card(page)).toBeVisible();
});

test('a person searching (Ctrl K) as the card appears keeps the search field: Enter opens what they searched, approves nothing (review of phase 8)', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: model(), paceMs: 60 } });
  await writeFile(join(home, 'notes.txt'), 'old line\n');
  const ui = chat(page);
  await ui.send('Change la note');
  await expect(ui.streamingReplies).toHaveCount(1, { timeout: 10_000 });
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: 'Rechercher' }).or(page.getByRole('searchbox')).or(page.getByRole('textbox', { name: /Rechercher/ })).first();
  await expect(search).toBeFocused();
  await page.keyboard.type('note');
  await expect(card(page)).toBeAttached({ timeout: 15_000 });
  await page.waitForTimeout(200);
  await expect(search).toBeFocused();
  expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('old line\n');
});

test('the keyboard: Enter allows, Escape refuses', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: model() } });
  await writeFile(join(home, 'notes.txt'), 'old line\n');
  const ui = chat(page);
  await ui.send('Change la note');
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(ui.replyText).toHaveText('Fait.', { timeout: 15_000 });
  expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('old line\n');

  await ui.send('Change encore la note');
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Enter');
  await expect(card(page)).toHaveCount(0);
  await expect.poll(() => readFile(join(home, 'notes.txt'), 'utf8'), { timeout: 15_000 }).toBe('new line\n');
});

test('the keyboard: Enter presses the button that has the focus — « Refuser… » never allows', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: model() } });
  await writeFile(join(home, 'notes.txt'), 'old line\n');
  const ui = chat(page);
  await ui.send('Change la note');
  const request = card(page);
  await expect(request).toBeVisible({ timeout: 15_000 });
  await request.getByRole('button', { name: 'Refuser…' }).focus();
  await page.keyboard.press('Enter');
  // Enter on « Refuser… » opens the refusal, and allows nothing.
  await expect(request.getByRole('textbox')).toBeVisible();
  expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('old line\n');
  await page.keyboard.press('Escape');
  await expect(ui.replyText).toHaveText('Fait.', { timeout: 15_000 });
  expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('old line\n');

  // Enter on « Autoriser et passer en Plume » does both.
  await ui.send('Change encore la note');
  await expect(request).toBeVisible({ timeout: 15_000 });
  await request.getByRole('button', { name: 'Autoriser et passer en Plume' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => readFile(join(home, 'notes.txt'), 'utf8'), { timeout: 15_000 }).toBe('new line\n');
  await expect(chat(page).modeShown).toHaveText('Plume');
});
