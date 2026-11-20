/**
 * The pull request of a conversation's branch, and archiving it (board
 * « Branches et conversations », task 6.8) — GitHub's CLI a fake one: a
 * test run never asks GitHub. The row and the header say the PR and its
 * CI, « Voir la PR » opens its page; archiving with changes not committed
 * asks « Annuler », « Archiver quand même » or « Commiter d'abord »; a PR
 * merged archives the conversation by itself.
 */

import { tempRepo, type TempRepo } from '@aparte/bonaparte-core/testing';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type LaunchOptions } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const EDIT = `<|tool_call>call:edit_file{path:${Q}notes.txt${Q},old_string:${Q}first${Q},new_string:${Q}second${Q}}<tool_call|>`;
const PR = { number: 42, url: 'https://github.com/example/project/pull/42', statusCheckRollup: [{ conclusion: 'SUCCESS', status: 'COMPLETED' }] };

function model(prompt: string): string {
  return prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user') ? 'Fait.' : EDIT;
}

/** A conversation of a git project, on its own branch, which changed notes.txt there. */
async function onItsBranch(launch: (options?: LaunchOptions) => ReturnType<typeof import('./fixtures/app.js').launchApp>, repo: TempRepo, gh?: LaunchOptions['gh']) {
  const launched = await launch({ engine: { responder: model }, env: { BONAPARTE_E2E_PICK_FOLDER: repo.dir }, ...(gh ? { gh } : {}) });
  const { page } = launched;
  await page.getByRole('button', { name: 'Nouveau projet' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau projet' });
  await dialog.getByRole('button', { name: 'Choisir un dossier…' }).click();
  await expect(dialog).toContainText('Un dépôt git, sur main');
  await dialog.getByRole('radio', { name: /Plume/ }).check();
  await dialog.getByRole('button', { name: 'Créer le projet' }).click();
  await page.getByRole('radiogroup', { name: 'Où travaille la conversation' }).getByRole('radio', { name: /Sur sa propre branche/ }).check();
  await page.getByRole('textbox', { name: 'Branche' }).fill('bonaparte/heures');
  await chat(page).send('Change la note');
  await expect(chat(page).replyText).toHaveText('Fait.', { timeout: 15_000 });
  return launched;
}

const nav = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Projets et conversations' });

test('the row and the header say the pull request and its CI; « Voir la PR » opens its page', async ({ launch }) => {
  const repo = await tempRepo({ 'notes.txt': 'first\n' });
  try {
    const { app, page } = await onItsBranch(launch, repo, { pr: { ...PR, state: 'OPEN' } });
    await expect(nav(page).getByRole('img', { name: 'pull request 42 ouverte, CI réussie' })).toBeVisible({ timeout: 10_000 });
    const header = page.locator('.conversation-header');
    await expect(header).toContainText('PR 42 · CI réussie');
    await header.getByRole('button', { name: 'Voir la PR' }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as { __openedLinks?: string[] }).__openedLinks ?? [])).toEqual([PR.url]);
  } finally {
    await repo.remove();
  }
});

test('archiving with changes not committed asks first; « Commiter d’abord » commits them, then archives', async ({ launch }) => {
  const repo = await tempRepo({ 'notes.txt': 'first\n' });
  try {
    const { page } = await onItsBranch(launch, repo);
    // Without GitHub's CLI, no pull request is shown — « Ouvrir une PR » is offered instead.
    await expect(page.locator('.conversation-header').getByRole('button', { name: 'Voir la PR' })).toHaveCount(0);
    const main = (await readFile(join(repo.dir, '.git', 'refs', 'heads', 'main'), 'utf8')).trim();

    await page.getByRole('button', { name: 'Plus d’actions' }).click();
    await page.getByRole('menuitem', { name: 'Archiver' }).click();
    const dialog = page.getByRole('dialog', { name: 'Archiver « Change la note » ?' });
    await expect(dialog).toContainText('Sa branche a 1 fichier modifié, pas encore commité.');
    await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Archiver quand même' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Commiter d’abord' }).click();

    await expect(nav(page).getByRole('button', { name: /^Change la note/ })).toHaveCount(0, { timeout: 10_000 });
    const branch = (await readFile(join(repo.dir, '.git', 'refs', 'heads', 'bonaparte', 'heures'), 'utf8')).trim();
    expect(branch).not.toBe(main);
    // Archived, its folder stays.
    expect(await readFile(join(repo.dir, '.bonaparte', 'worktrees', 'heures', 'notes.txt'), 'utf8')).toBe('second\n');
  } finally {
    await repo.remove();
  }
});

test('a pull request merged archives its conversation by itself — once the person has left it', async ({ launch }) => {
  const repo = await tempRepo({ 'notes.txt': 'first\n' });
  try {
    const { page } = await onItsBranch(launch, repo, { pr: { ...PR, state: 'MERGED' } });
    // The reply the person is reading does not vanish under their eyes.
    await page.waitForTimeout(1_500);
    await expect(chat(page).replyText).toHaveText('Fait.');
    await expect(nav(page).getByRole('button', { name: /^Change la note/ })).toHaveCount(1);
    await page.getByRole('button', { name: 'Nouvelle conversation', exact: true }).first().click();
    await expect(nav(page).getByRole('button', { name: /^Change la note/ })).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await repo.remove();
  }
});
