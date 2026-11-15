/**
 * The « Fichiers » pane (board « Conversation au travail », task 6.3): the
 * tree of the perimeter, opened folder by folder, by the mouse or the keys;
 * a file's preview, read-only, with its line numbers; « P » on a file a
 * change waits on, « M » on a file the conversation changed.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const EDIT = `<|tool_call>call:edit_file{path:${Q}notes.txt${Q},old_string:${Q}first${Q},new_string:${Q}second${Q}}<tool_call|>`;

test('the tree opens folder by folder, by the mouse and by the keys; a file shows read-only, with its line numbers', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: () => 'ok' } });
  await mkdir(join(home, 'src'), { recursive: true });
  await writeFile(join(home, 'src', 'format.ts'), 'export const a = 1;\nexport const b = 2;\n');
  await writeFile(join(home, 'notes.txt'), 'first\nsecond line\n');
  await expect(chat(page).editor).toBeVisible();
  await page.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Fichiers', exact: true }).click();

  const tree = page.getByRole('tree', { name: 'Fichiers du projet' });
  const src = tree.getByRole('treeitem', { name: /^src/ });
  await expect(src).toHaveAttribute('aria-expanded', 'false');
  await expect(tree.getByRole('treeitem', { name: /^notes\.txt/ })).toBeVisible();
  await src.click();
  await expect(src).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.getByRole('treeitem', { name: /^format\.ts/ })).toBeVisible();
  // The keys: left folds it, right opens it again, down goes to its file, Enter shows it.
  await src.press('ArrowLeft');
  await expect(src).toHaveAttribute('aria-expanded', 'false');
  await src.press('ArrowRight');
  await expect(src).toHaveAttribute('aria-expanded', 'true');
  await src.press('ArrowDown');
  await expect(tree.getByRole('treeitem', { name: /^format\.ts/ })).toBeFocused();
  await page.keyboard.press('Enter');
  const preview = page.getByRole('region', { name: 'Aperçu de src/format.ts' });
  await expect(preview).toContainText('export const b = 2;');
  await expect(preview.locator('.files-pane__gutter')).toContainText('2');

  await tree.getByRole('treeitem', { name: /^notes\.txt/ }).click();
  await expect(page.getByRole('region', { name: 'Aperçu de notes.txt' })).toContainText('second line');
});

test('« P » on a file a change waits on, « M » once the conversation changed it', async ({ launch }) => {
  let asked = 0;
  const { page, home } = await launch({ engine: { responder: () => (asked++ === 0 ? EDIT : 'Fait.') } });
  await writeFile(join(home, 'notes.txt'), 'first\n');
  await writeFile(join(home, 'other.txt'), 'other\n');
  await chat(page).send('Change la note');
  await expect(page.getByRole('region', { name: 'Demande d’accord' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Fichiers', exact: true }).click();
  const tree = page.getByRole('tree', { name: 'Fichiers du projet' });
  await expect(tree.getByRole('treeitem', { name: 'notes.txt, proposé, attend ton accord' })).toBeVisible();
  await expect(tree.getByRole('treeitem', { name: 'other.txt', exact: true })).toBeVisible();

  await page.getByRole('region', { name: 'Demande d’accord' }).getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect(chat(page).replyText).toHaveText('Fait.', { timeout: 15_000 });
  await expect(tree.getByRole('treeitem', { name: 'notes.txt, modifié par la conversation' })).toBeVisible();
});
