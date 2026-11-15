/**
 * An approval survives the app: quit while a call waits for the person,
 * launch again, open the conversation — the card is back, nothing was
 * written, and « Autoriser » finishes the reply that was paused. The core
 * kept the pause in its journal and its signed ticket; the page kept the
 * paused call in aparté's document, and asks again on loading it
 * (`resumeDeferred`).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const EDIT = `<|tool_call>call:edit_file{path:${Q}notes.txt${Q},old_string:${Q}old line${Q},new_string:${Q}new line${Q}}<tool_call|>`;

function model(prompt: string): string {
  const user = prompt.lastIndexOf('<|turn>user');
  if (prompt.lastIndexOf('<|tool_response>') > user) return 'Fait.';
  return prompt.slice(user).includes('note') ? EDIT : 'ok';
}

const card = (page: Page) => page.getByRole('region', { name: 'Demande d’accord' });

test('an approval asked before the app quit is asked again after it, and « Autoriser » finishes the reply', async ({ launch }) => {
  const first = await launch({ engine: { responder: model }, keepData: true });
  await writeFile(join(first.home, 'notes.txt'), 'old line\n');
  await chat(first.page).send('Change la note');
  await expect(card(first.page)).toBeVisible({ timeout: 15_000 });

  // Quit as the person does, the call still waiting.
  const main = first.app.process();
  const exited = new Promise<void>((resolve) => main.once('exit', () => resolve()));
  await first.app.evaluate(({ app }) => app.quit()).catch(() => undefined);
  await exited;
  await first.close();

  const second = await launch({ engine: { responder: model }, dataDir: first.dataDir });
  await second.page.locator('aparte-conversation-list').getByRole('button', { name: /Change la note/ }).click();
  const request = card(second.page);
  await expect(request).toBeVisible({ timeout: 15_000 });
  await expect(request).toContainText('notes.txt');
  expect(await readFile(join(second.home, 'notes.txt'), 'utf8')).toBe('old line\n');

  await request.getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect(chat(second.page).replyText).toHaveText('Fait.', { timeout: 15_000 });
  expect(await readFile(join(second.home, 'notes.txt'), 'utf8')).toBe('new line\n');
});
