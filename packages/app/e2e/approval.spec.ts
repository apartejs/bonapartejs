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
