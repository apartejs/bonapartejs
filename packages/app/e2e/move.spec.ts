/**
 * A conversation moved to another project (Paul, 2026-11-19; aparté 1.16, apartejs/aparte#269): « Déplacer
 * vers… » in its row's menu, or the row dragged onto the project's heading (apartejs/aparte#278: our lists are
 * one per project). Its folders are told to the model at its next turn; under a question or an approval that
 * waits, it stays where it is and the sidebar says why.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';

async function ask(page: Page, text: string): Promise<void> {
  const ui = chat(page);
  const before = await ui.replies.count();
  await ui.send(text);
  await expect(ui.replies).toHaveCount(before + 1, { timeout: 15_000 });
  await expect(ui.streamingReplies).toHaveCount(0, { timeout: 15_000 });
}

/** A second project made from a folder: its group in the sidebar. */
async function secondProject(page: Page, folder: string) {
  const nav = page.getByRole('navigation', { name: 'Projets et conversations', exact: true });
  await nav.getByRole('button', { name: 'Nouveau projet' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau projet' });
  await dialog.getByRole('button', { name: 'Choisir un dossier…' }).click();
  await dialog.getByRole('button', { name: 'Créer le projet' }).click();
  await expect(dialog).toBeHidden();
  return { nav, home: nav.getByRole('group', { name: 'maison', exact: true }), other: nav.getByRole('group', { name: basename(folder), exact: true }) };
}

test('« Déplacer vers… » moves a conversation to another project: its row, its header, and its next turn told the new folder', async ({ launch }) => {
  const folder = await mkdtemp(join(tmpdir(), 'spanwise-'));
  const prompts: string[] = [];
  try {
    const { page } = await launch({
      engine: {
        responder: (prompt) => {
          prompts.push(prompt);
          return 'ok';
        },
      },
      env: { BONAPARTE_E2E_PICK_FOLDER: folder },
    });
    const { home, other } = await secondProject(page, folder);
    await home.getByRole('button', { name: 'Nouvelle conversation dans maison', exact: true }).click();
    await ask(page, 'Dans la maison');
    await home.locator('[data-conv-id]', { hasText: 'Dans la maison' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Déplacer vers…' }).click();
    // Its own project is not offered: only the others.
    await expect(page.getByRole('menuitem', { name: 'maison', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: basename(folder), exact: true }).click();
    await expect(other).toContainText('Dans la maison');
    await expect(home).not.toContainText('Dans la maison');
    await expect(page.locator('.conversation-header')).toContainText(basename(folder));
    await ask(page, 'Et maintenant ?');
    expect(prompts.at(-1)).toContain(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('a row dragged onto another project’s heading moves there', async ({ launch }) => {
  const folder = await mkdtemp(join(tmpdir(), 'spanwise-'));
  try {
    const { page } = await launch({ engine: { responder: () => 'ok' }, env: { BONAPARTE_E2E_PICK_FOLDER: folder } });
    const { home, other } = await secondProject(page, folder);
    await home.getByRole('button', { name: 'Nouvelle conversation dans maison', exact: true }).click();
    await ask(page, 'À glisser');
    await home.locator('[data-conv-id]', { hasText: 'À glisser' }).dragTo(other.locator('.bonaparte-project__head'));
    await expect(other).toContainText('À glisser');
    await expect(home).not.toContainText('À glisser');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('a conversation that waits for an approval stays where it is, and the sidebar says why', async ({ launch }) => {
  const folder = await mkdtemp(join(tmpdir(), 'spanwise-'));
  try {
    const { page } = await launch({
      engine: {
        responder: (prompt) =>
          prompt.slice(prompt.lastIndexOf('<|turn>user')).includes('Change')
            ? `<|tool_call>call:write_file{path:${Q}note.txt${Q},content:${Q}x${Q}}<tool_call|>`
            : 'ok',
      },
      env: { BONAPARTE_E2E_PICK_FOLDER: folder },
    });
    const { home, other } = await secondProject(page, folder);
    await home.getByRole('button', { name: 'Nouvelle conversation dans maison', exact: true }).click();
    await chat(page).send('Change la note');
    await expect(page.getByRole('region', { name: 'Demande d’accord' })).toBeVisible({ timeout: 15_000 });
    await home.locator('[data-conv-id]', { hasText: 'Change la note' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Déplacer vers…' }).click();
    await page.getByRole('menuitem', { name: basename(folder), exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'attend ta réponse' })).toBeVisible();
    // Above the lists, which scroll: seen whatever their scroll (review of 2026-11-20).
    await expect(page.locator('.bonaparte-sidebar__body .bonaparte-move-notice')).toHaveCount(0);
    await expect(home).toContainText('Change la note');
    await expect(other).not.toContainText('Change la note');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
