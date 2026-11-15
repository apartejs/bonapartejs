/**
 * The lines of the tools' calls in a reply, as the board « Conversation au
 * travail » draws them: « Lu notes.txt · 2 lignes »; « Modifier notes.txt ·
 * Attend ton accord » while the person decides; « Modifié » once allowed,
 * with the change behind its line.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const READ = `<|tool_call>call:read_file{path:${Q}notes.txt${Q}}<tool_call|>`;
const EDIT = `<|tool_call>call:edit_file{path:${Q}notes.txt${Q},old_string:${Q}old line${Q},new_string:${Q}new line${Q}}<tool_call|>`;

/** The model reads the note when asked to read it, edits it when asked to change it, and says « Fait. » once it has a result. */
function model(prompt: string): string {
  const user = prompt.lastIndexOf('<|turn>user');
  if (prompt.lastIndexOf('<|tool_response>') > user) return 'Fait.';
  const asked = prompt.slice(user);
  if (asked.includes('Lis')) return READ;
  if (asked.includes('Change')) return EDIT;
  return 'ok';
}

test('a read says what it read, and how much', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: model } });
  await writeFile(join(home, 'notes.txt'), 'old line\nsecond line\n');
  const ui = chat(page);
  await ui.send('Lis la note');
  await expect(ui.replyText).toHaveText('Fait.', { timeout: 15_000 });
  const line = ui.toolLine('read_file');
  await expect(line).toContainText('Lu');
  await expect(line).toContainText('notes.txt');
  await expect(line).toContainText('2 lignes');
});

test('an edit waits under its name, then says it is done, with its change behind its line', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: model } });
  await writeFile(join(home, 'notes.txt'), 'old line\n');
  const ui = chat(page);
  await ui.send('Change la note');
  const line = ui.toolLine('edit_file');
  await expect(line).toContainText('Modifier', { timeout: 15_000 });
  await expect(line).toContainText('Attend ton accord');

  await page.getByRole('region', { name: 'Demande d’accord' }).getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect(ui.replyText).toHaveText('Fait.', { timeout: 15_000 });
  await expect(line).toContainText('Modifié');
  await expect(line.locator('aparte-diff')).toContainText('new line');
});
