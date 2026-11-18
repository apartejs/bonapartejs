/**
 * « Réglages · Permissions » and a project's page (task 5.7): the default
 * mode, a file added to « toujours demandé », the network asked or not — all
 * kept by the core —; a project opened from its row: its folders, its
 * instructions, its own default mode and its own list.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const settingsOf = async (dataDir: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(dataDir, 'config', 'global.json'), 'utf8')).settings ?? {};

test('the default mode, the files always asked and the network, kept by the core', async ({ launch }) => {
  const { page, dataDir } = await launch({ engine: { responder: () => 'ok' } });
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: 'Permissions' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Permissions' })).toBeVisible();

  await page.getByRole('radiogroup', { name: 'Mode par défaut' }).getByRole('radio', { name: /Plume/ }).check();
  await page.getByRole('textbox', { name: 'Fichier à toujours demander' }).fill('Dockerfile');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retirer Dockerfile' })).toBeVisible();
  await page.getByRole('switch', { name: 'Demander avant chaque accès au réseau, même en Plume et en Impro' }).click();
  await expect
    .poll(() => settingsOf(dataDir))
    .toMatchObject({ defaultMode: 'plume', alwaysAsk: ['Dockerfile'], askBeforeNetwork: false });

  await page.getByRole('button', { name: 'Retirer Dockerfile' }).click();
  await expect.poll(() => settingsOf(dataDir)).toMatchObject({ alwaysAsk: [] });

  // A new project starts in the default mode (a conversation without a project is a discussion, task 9.7).
  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: 'Conversations' }).click();
  await page.getByRole('button', { name: 'Nouveau projet' }).click();
  const made = page.getByRole('dialog', { name: 'Nouveau projet' });
  await expect(made.getByRole('radio', { name: /Plume/ })).toBeChecked();
});

test('a project opened from « Permissions »: its folders, its instructions, its own mode and list', async ({ launch }) => {
  const folder = await mkdtemp(join(tmpdir(), 'spanwise-'));
  try {
    await writeFile(join(folder, 'AGENTS.md'), '# spanwise\n');
    const { page, dataDir } = await launch({ engine: { responder: () => 'ok' }, env: { BONAPARTE_E2E_PICK_FOLDER: folder } });
    await page.getByRole('button', { name: 'Nouveau projet' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouveau projet' });
    await dialog.getByRole('button', { name: 'Choisir un dossier…' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Nom' })).toHaveValue(/^spanwise-/);
    await dialog.getByRole('button', { name: 'Créer le projet' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Réglages', exact: true }).click();
    await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: 'Permissions' }).click();
    await page.getByRole('button', { name: /^Ouvrir spanwise-/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: /^spanwise-/ })).toBeVisible();
    const folders = page.getByRole('region', { name: 'Dossiers' });
    await expect(folders.getByText(folder, { exact: true })).toBeVisible();
    await expect(folders.getByText('racine')).toBeVisible();
    await expect(page.getByText(/AGENTS\.md trouvé à la racine/)).toBeVisible();

    await page.getByRole('radiogroup', { name: 'Mode par défaut des conversations de ce projet' }).getByRole('radio', { name: /Lecture/ }).check();
    await page.getByRole('textbox', { name: 'Fichier à toujours demander' }).fill('Makefile');
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    const stored = async (): Promise<string> =>
      JSON.stringify(JSON.parse(await readFile(join(dataDir, 'projects.json'), 'utf8')));
    await expect.poll(stored).toContain('"defaultMode":"lecture"');
    await expect.poll(stored).toContain('"alwaysAsk":["Makefile"]');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('the default mode applies from the launch; an Impro default starts in Plume, until the person picks Impro', async ({ launch }) => {
  const lecture = await launch({ engine: { responder: () => 'ok' }, settings: { defaultMode: 'lecture', reopenLast: false } });
  await expect(chat(lecture.page).modeShown).toHaveText('Lecture');
  await lecture.close();
  const impro = await launch({ engine: { responder: () => 'ok' }, settings: { defaultMode: 'impro' } });
  await expect(chat(impro.page).modeShown).toHaveText('Plume');
});

test("a project's default mode changed in the settings is the one of its next conversation", async ({ launch }) => {
  const folder = await mkdtemp(join(tmpdir(), 'spanwise-'));
  try {
    const { page } = await launch({ engine: { responder: () => 'ok' }, env: { BONAPARTE_E2E_PICK_FOLDER: folder } });
    await page.getByRole('button', { name: 'Nouveau projet' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouveau projet' });
    await dialog.getByRole('button', { name: 'Choisir un dossier…' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Nom' })).toHaveValue(/^spanwise-/);
    await dialog.getByRole('button', { name: 'Créer le projet' }).click();
    await expect(dialog).toBeHidden();
    await chat(page).send('Dans le projet');
    await expect(chat(page).replyText).toHaveText('ok', { timeout: 15_000 });

    await page.getByRole('button', { name: 'Réglages', exact: true }).click();
    const nav = page.getByRole('navigation', { name: 'Réglages' });
    await nav.getByRole('link', { name: 'Permissions' }).click();
    await page.getByRole('button', { name: /^Ouvrir spanwise-/ }).click();
    await page.getByRole('radiogroup', { name: 'Mode par défaut des conversations de ce projet' }).getByRole('radio', { name: /Lecture/ }).check();
    // « Permissions » in the navigation leaves the project's page.
    await nav.getByRole('link', { name: 'Permissions' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Permissions' })).toBeVisible();
    await nav.getByRole('link', { name: 'Conversations' }).click();
    await page.getByRole('button', { name: 'Nouvelle conversation' }).first().click();
    await expect(chat(page).modeShown).toHaveText('Lecture');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('Ctrl K over the settings closes them and opens « Rechercher »; Ctrl B folds the sidebar the person sees', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Réglages' })).toBeVisible();
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('navigation', { name: 'Réglages' })).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Rechercher' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await page.keyboard.press('Control+B');
  await expect(page.getByRole('navigation', { name: 'Projets et conversations, barre réduite' })).toBeVisible();
});

test('a project made with an Impro default starts its first conversation in Plume, as any default', async ({ launch }) => {
  const folder = await mkdtemp(join(tmpdir(), 'spanwise-'));
  try {
    const { page } = await launch({ engine: { responder: () => 'ok' }, env: { BONAPARTE_E2E_PICK_FOLDER: folder } });
    await page.getByRole('button', { name: 'Nouveau projet' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouveau projet' });
    await dialog.getByRole('button', { name: 'Choisir un dossier…' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Nom' })).toHaveValue(/^spanwise-/);
    await dialog.getByRole('radio', { name: /Impro/ }).check();
    await dialog.getByRole('button', { name: 'Créer le projet' }).click();
    await expect(dialog).toBeHidden();
    await expect(chat(page).modeShown).toHaveText('Plume');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

