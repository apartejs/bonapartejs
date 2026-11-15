/**
 * The composer's toolbar (task 5.6, board « Conversation au travail »): « / »
 * at the start of a message lists the commands — not aparté's approval one,
 * the mode switch is there — and « / new » starts a new conversation; « @ »
 * lists the files of the project and puts the chosen path in the message;
 * the model the engine runs is named.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

test('« / » lists the commands, and the one for a new conversation starts one', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  const ui = chat(page);
  await ui.send('Bonjour');
  await expect(ui.replyText).toHaveText('ok', { timeout: 15_000 });

  await ui.editor.click();
  await page.keyboard.type('/');
  const list = page.getByRole('listbox');
  // Exactly these: no approval command beside the mode switch, whatever a plugin adds.
  await expect(list.getByRole('option')).toHaveText([/^\/new/, /^\/retry/, /^\/copy/, /^\/compact/]);
  await list.getByRole('option', { name: /Commencer une nouvelle conversation/ }).click();
  await expect(ui.userMessages).toHaveCount(0);
});

test('« @ » lists the files of the project, and puts the path chosen in the message', async ({ launch }) => {
  const folder = await mkdtemp(join(tmpdir(), 'spanwise-'));
  try {
    await mkdir(join(folder, 'src'));
    await writeFile(join(folder, 'src', 'format.ts'), 'export {};\n');
    await writeFile(join(folder, 'README.md'), '# spanwise\n');
    const { page } = await launch({ engine: { responder: () => 'ok' }, env: { BONAPARTE_E2E_PICK_FOLDER: folder } });
    await page.getByRole('button', { name: 'Nouveau projet' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouveau projet' });
    await dialog.getByRole('button', { name: 'Choisir un dossier…' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Nom' })).toHaveValue(/^spanwise-/);
    await dialog.getByRole('button', { name: 'Créer le projet' }).click();
    await expect(dialog).toBeHidden();

    await chat(page).editor.click();
    await page.keyboard.type('Regarde @form');
    const option = page.getByRole('listbox').getByRole('option', { name: /src\/format\.ts/ });
    await expect(option).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(chat(page).composerBox).toContainText('src/format.ts');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('the composer names the model the engine runs', async ({ launch }) => {
  const { page } = await launch({ managed: { models: { 'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 } } } });
  await page.getByRole('button', { name: 'Démarrer' }).click();
  await expect(chat(page).composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });
  // aparté's model selector (task 7.4): its button names the model that runs.
  await expect(page.locator('aparte-composer-toolbar').getByRole('combobox', { name: 'Modèle' })).toContainText('gemma-4-e2e');
});
