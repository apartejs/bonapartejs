/**
 * The sidebar (task 5.6, board « Conversation au travail »): the conversations
 * under their project, the others under « Discussions »; each row says where
 * its memory is and whether it waits for the person — by a name, never by a
 * colour alone; Ctrl B folds it into a column of icons, each named on hover.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';
import { conversationList } from './fixtures/conversations.js';

async function ask(page: Page, text: string): Promise<void> {
  const ui = chat(page);
  const before = await ui.replies.count();
  await ui.send(text);
  await expect(ui.replies).toHaveCount(before + 1, { timeout: 15_000 });
  await expect(ui.streamingReplies).toHaveCount(0, { timeout: 15_000 });
}

test('the conversations sit under their project, the others under « Discussions »', async ({ launch }) => {
  const folder = await mkdtemp(join(tmpdir(), 'spanwise-'));
  try {
    const { page } = await launch({ project: false, engine: { responder: () => 'ok' }, env: { BONAPARTE_E2E_PICK_FOLDER: folder } });
    await ask(page, 'Hors projet');

    const nav = page.getByRole('navigation', { name: 'Projets et conversations', exact: true });
    await nav.getByRole('button', { name: 'Nouveau projet' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouveau projet' });
    await dialog.getByRole('button', { name: 'Choisir un dossier…' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Nom' })).toHaveValue(/^spanwise-/);
    await dialog.getByRole('button', { name: 'Créer le projet' }).click();
    await expect(dialog).toBeHidden();
    await ask(page, 'Dans le projet');

    const project = nav.getByRole('group', { name: /^spanwise-/ });
    await expect(project).toContainText('Dans le projet');
    await expect(project).not.toContainText('Hors projet');
    const discussions = nav.getByRole('group', { name: 'Discussions' });
    await expect(discussions).toContainText('Hors projet');
    await expect(discussions).not.toContainText('Dans le projet');

    // The project's row folds its conversations away, and says how many it holds.
    const header = project.getByRole('button', { name: /^spanwise-.*1 conversation$/ });
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(conversationList(page).row('Dans le projet')).toBeHidden();
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('with « one list », every conversation is in one list, by date', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' }, settings: { sidebarGrouping: 'single' } });
  await ask(page, 'Une conversation');
  const nav = page.getByRole('navigation', { name: 'Projets et conversations', exact: true });
  await expect(conversationList(page).row('Une conversation')).toBeVisible();
  await expect(nav.getByRole('group', { name: 'Discussions' })).toHaveCount(0);
});

const MODELS = { 'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 } };

test('each row says where its memory is — in the engine, or saved — by its name', async ({ launch }) => {
  const { page } = await launch({ managed: { models: MODELS } });
  await page.getByRole('button', { name: 'Démarrer' }).click();
  await expect(chat(page).composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });
  await ask(page, 'Première question');
  await page.getByRole('button', { name: 'Nouvelle conversation' }).first().click();
  await expect(chat(page).userMessages).toHaveCount(0);
  await ask(page, 'Deuxième question');

  const list = conversationList(page);
  // A mark of the row (aparté's renderMeta), named, read after the title and drawn before it.
  await expect(list.row('Deuxième question').getByRole('img', { name: 'Contexte dans le moteur', exact: true })).toBeVisible();
  await expect(list.row('Première question').getByRole('img', { name: 'Mémoire sauvée', exact: true })).toBeVisible();
  const [mark, title] = await Promise.all([
    list.row('Première question').getByRole('img', { name: 'Mémoire sauvée', exact: true }).boundingBox(),
    list.row('Première question').getByRole('button', { name: /^Première question/ }).boundingBox(),
  ]);
  expect(mark!.x).toBeLessThan(title!.x + 16);
});

const Q = '<|"|>';
const EDIT = `<|tool_call>call:edit_file{path:${Q}notes.txt${Q},old_string:${Q}first${Q},new_string:${Q}second${Q}}<tool_call|>`;

test('a conversation that waits for the person says so in the list, after a restart too', async ({ launch }) => {
  const first = await launch({ engine: { responder: () => EDIT }, keepData: true });
  await writeFile(join(first.home, 'notes.txt'), 'first\n');
  await chat(first.page).send('Change la note');
  await expect(first.page.getByRole('region', { name: 'Demande d’accord' })).toBeVisible({ timeout: 15_000 });
  await expect(conversationList(first.page).row('Change la note').getByRole('button', { name: /Attend ta réponse/ })).toBeVisible();
  // The board's amber, the colour of what waits (the approval card, « À traiter »'s count) — never the accent's ink,
  // which a reply not read yet wears too (phase 8).
  const shown = await conversationList(first.page).statusColour('Change la note', '--aparte-warning');
  expect(shown.dot).toBe(shown.token);
  await first.close();

  // Not reopened: the list alone says it, from what the core kept.
  const again = await launch({ engine: { responder: () => 'Fait.' }, dataDir: first.dataDir, settings: { reopenLast: false } });
  await expect(conversationList(again.page).row('Change la note').getByRole('button', { name: /Attend ta réponse/ })).toBeVisible();
});

test('Ctrl B folds the sidebar into a column of icons, each named on hover, and back', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await expect(chat(page).editor).toBeVisible();
  await page.keyboard.press('Control+B');
  const rail = page.getByRole('navigation', { name: 'Projets et conversations, barre réduite' });
  await expect(rail).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Projets et conversations', exact: true })).toHaveCount(0);
  for (const name of ['Déplier la barre latérale', 'Nouvelle conversation', 'Rechercher']) {
    await expect(rail.getByRole('button', { name })).toBeVisible();
  }
  await rail.getByRole('button', { name: 'Déplier la barre latérale' }).hover();
  await expect(rail.getByText('Déplier · Ctrl B')).toBeVisible();

  await page.keyboard.press('Control+B');
  await expect(page.getByRole('navigation', { name: 'Projets et conversations', exact: true })).toBeVisible();
  await expect(rail).toHaveCount(0);
});

test('a narrow window folds the sidebar into icons', async ({ launch }) => {
  const { app, page } = await launch({ engine: { responder: () => 'ok' } });
  await expect(page.getByRole('navigation', { name: 'Projets et conversations', exact: true })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1000, 760));
  await expect(page.getByRole('navigation', { name: 'Projets et conversations, barre réduite' })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 860));
  await expect(page.getByRole('navigation', { name: 'Projets et conversations', exact: true })).toBeVisible();
});

test("a row's menu opens on a right click; a conversation is pinned, renamed and archived from the list", async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await ask(page, 'Première');
  await page.getByRole('button', { name: 'Nouvelle conversation' }).first().click();
  await ask(page, 'Seconde');
  const list = conversationList(page);

  await list.row('Première').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Épingler' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Épingler' }).click();
  await expect.poll(async () => (await list.list.locator('[data-conv-id]').allTextContents()).map((text) => text.trim())[0]).toContain('Première');

  await list.openMenu('Seconde');
  await page.getByRole('menuitem', { name: 'Renommer' }).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Deuxième');
  await page.keyboard.press('Enter');
  await expect(list.row('Deuxième')).toBeVisible();

  await list.openMenu('Deuxième');
  await page.getByRole('menuitem', { name: 'Archiver' }).click();
  await expect(list.row('Deuxième')).toHaveCount(0);
});

