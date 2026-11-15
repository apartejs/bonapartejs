/**
 * The « Changements » pane (board « Conversation au travail », task 6.4):
 * each file the conversation changed, « Appliqué », with its diff — aparté's
 * own view — folded on a click; « Revenir » puts one file back; a change
 * that waits for the person is there too, « Proposé ». The header's counts
 * open the pane.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const EDIT = `<|tool_call>call:edit_file{path:${Q}notes.txt${Q},old_string:${Q}first${Q},new_string:${Q}second${Q}}<tool_call|>`;
const WRITE = `<|tool_call>call:write_file{path:${Q}new.txt${Q},content:${Q}fresh${Q}}<tool_call|>`;

/** Writes both files once, then says it is done. */
function model(prompt: string): string {
  return prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user') ? 'Fait.' : EDIT + WRITE;
}

test('each file the conversation changed, with its diff; folded on a click; « Revenir » puts one back', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: model }, settings: { defaultMode: 'plume' } });
  await writeFile(join(home, 'notes.txt'), 'first\n');
  await chat(page).send('Change la note');
  await expect(chat(page).replyText).toHaveText('Fait.', { timeout: 15_000 });

  // The header's counts open the pane.
  await page.getByRole('button', { name: '+2 −1, voir les changements' }).click();
  const pane = page.getByRole('region', { name: 'Changements', exact: true });
  await expect(pane).toBeVisible();
  await expect(pane.locator('.bonaparte-pane__meta')).toHaveText('2 fichiers · +2 −1');

  // A card per file: its state, and aparté's diff, whose header folds it.
  const notes = pane.getByRole('region', { name: 'notes.txt', exact: true });
  await expect(notes).toContainText('Appliqué');
  await expect(notes.locator('aparte-diff')).toContainText('second');
  const fold = notes.getByRole('button', { name: 'notes.txt', exact: true });
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');

  await pane.getByRole('button', { name: 'Revenir sur notes.txt' }).click();
  await expect.poll(() => readFile(join(home, 'notes.txt'), 'utf8')).toBe('first\n');
  await expect(notes).toHaveCount(0);
  await expect(pane.locator('.bonaparte-pane__meta')).toHaveText('1 fichier · +1 −0');
  // The file it created stays, untouched.
  expect(await readFile(join(home, 'new.txt'), 'utf8')).toBe('fresh');
});

test('a change that waits for the person is there, « Proposé », with what it would change, and nothing to put back', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: () => EDIT } });
  await writeFile(join(home, 'notes.txt'), 'first\n');
  await chat(page).send('Change la note');
  await expect(page.getByRole('region', { name: 'Demande d’accord' })).toBeVisible({ timeout: 15_000 });
  const pane = page.getByRole('region', { name: 'Changements', exact: true });
  await expect(pane).toBeVisible();
  const notes = pane.getByRole('region', { name: 'notes.txt', exact: true });
  await expect(notes).toContainText('Proposé');
  await expect(pane.locator('aparte-diff')).toContainText('second');
  await expect(pane.getByRole('button', { name: /^Revenir/ })).toHaveCount(0);
});
