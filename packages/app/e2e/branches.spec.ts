/**
 * A conversation on its own branch (board « Branches et conversations »,
 * task 6.7): chosen before its first message, in a git project; its
 * worktree made at its first write, which lands there and never in the
 * project's folder; the list says it is on its branch and how many files
 * changed; the header says its branch, and opens its folder.
 */

import { tempRepo } from '@aparte/bonaparte-core/testing';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const EDIT = `<|tool_call>call:edit_file{path:${Q}notes.txt${Q},old_string:${Q}first${Q},new_string:${Q}second${Q}}<tool_call|>`;

function model(prompt: string): string {
  return prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user') ? 'Fait.' : EDIT;
}

test('chosen before its first message, its worktree made at its first write; the list and the header say it', async ({ launch }) => {
  const repo = await tempRepo({ 'notes.txt': 'first\n' });
  try {
    const { app, page } = await launch({ engine: { responder: model }, env: { BONAPARTE_E2E_PICK_FOLDER: repo.dir } });
    await page.getByRole('button', { name: 'Nouveau projet' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouveau projet' });
    await dialog.getByRole('button', { name: 'Choisir un dossier…' }).click();
    await expect(dialog).toContainText('Un dépôt git, sur main');
    await dialog.getByRole('radio', { name: /Plume/ }).check();
    await dialog.getByRole('button', { name: 'Créer le projet' }).click();
    await expect(dialog).toBeHidden();

    const where = page.getByRole('radiogroup', { name: 'Où travaille la conversation' });
    await expect(where.getByRole('radio', { name: /Dans le dossier du projet/ })).toBeChecked();
    await where.getByRole('radio', { name: /Sur sa propre branche/ }).check();
    await page.getByRole('textbox', { name: 'Branche' }).fill('bonaparte/heures');
    await expect(page.getByRole('textbox', { name: 'Partir de' })).toHaveValue('main');
    await chat(page).send('Change la note');
    await expect(chat(page).replyText).toHaveText('Fait.', { timeout: 15_000 });

    const worktree = join(repo.dir, '.bonaparte', 'worktrees', 'heures');
    expect(await readFile(join(worktree, 'notes.txt'), 'utf8')).toBe('second\n');
    expect(await readFile(join(repo.dir, 'notes.txt'), 'utf8')).toBe('first\n');
    // Started, the conversation no longer offers the choice.
    await expect(where).toHaveCount(0);

    await expect(page.getByRole('navigation', { name: 'Projets et conversations' }).getByRole('img', { name: 'sur sa branche, 1 fichier changé' })).toBeVisible({
      timeout: 10_000,
    });
    const header = page.locator('.conversation-header');
    await expect(header).toContainText('bonaparte/heures');
    await header.getByRole('button', { name: 'Ouvrir le dossier' }).click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as { __openedFolders?: string[] }).__openedFolders ?? []))
      .toEqual([worktree]);
  } finally {
    await repo.remove();
  }
});
