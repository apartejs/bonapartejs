/**
 * A discussion (task 9.7, aligned with the market): a conversation without a project reaches no file and runs
 * nothing — no mode switch, no code panes, no file tool told to the model; it is listed under « Discussions ».
 * « Travailler dans un projet… » makes it a code conversation of a project: its mode switch, its tools.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

test('without a project, a new conversation is a discussion: no mode switch, no code panes, no file tool (task 9.7)', async ({ launch }) => {
  const prompts: string[] = [];
  const { page } = await launch({ project: false, engine: { responder: () => 'Bonjour à toi.', onCompletion: (body) => prompts.push(String(body['prompt'])) } });
  const ui = chat(page);
  await expect(ui.editor).toBeVisible();
  await expect(ui.modeShown).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Volets' })).toHaveCount(0);
  await ui.send('Bonjour');
  await expect(ui.replyText).toHaveText('Bonjour à toi.', { timeout: 15_000 });
  expect(prompts.at(-1)).toContain('web_fetch');
  expect(prompts.at(-1)).not.toMatch(/read_file|edit_file|run_command/);
  await expect(page.getByRole('group', { name: 'Discussions', exact: true })).toContainText('Bonjour');
  await expect(ui.modeShown).toHaveCount(0);
});

test('« Travailler dans un projet… »: the discussion works in a project — its mode switch, its tools (task 9.7)', async ({ launch }) => {
  const folder = await mkdtemp(join(tmpdir(), 'spanwise-'));
  try {
    const prompts: string[] = [];
    const { page } = await launch({
      project: false,
      engine: { responder: () => 'Entendu.', onCompletion: (body) => prompts.push(String(body['prompt'])) },
      env: { BONAPARTE_E2E_PICK_FOLDER: folder },
    });
    const ui = chat(page);
    await ui.send('Bonjour');
    await expect(ui.replies).toHaveCount(1, { timeout: 15_000 });
    await expect(ui.streamingReplies).toHaveCount(0, { timeout: 15_000 });

    await page.getByRole('button', { name: 'Plus d’actions' }).click();
    await page.getByRole('menuitem', { name: 'Travailler dans un projet…' }).click();
    const attach = page.getByRole('dialog', { name: 'Travailler dans un projet' });
    await attach.getByRole('button', { name: 'Nouveau projet…' }).click();
    const create = page.getByRole('dialog', { name: 'Nouveau projet' });
    await create.getByRole('button', { name: 'Choisir un dossier…' }).click();
    await create.getByRole('button', { name: 'Créer le projet' }).click();
    await expect(create).toBeHidden();

    // The same conversation, now in the project: its mode switch, its tools told at the next turn.
    await expect(ui.userMessages).toHaveCount(1);
    await expect(ui.modeShown).toBeVisible({ timeout: 10_000 });
    await ui.send('Regarde le projet');
    await expect(ui.replies).toHaveCount(2, { timeout: 15_000 });
    await expect(ui.streamingReplies).toHaveCount(0, { timeout: 15_000 });
    const turn = prompts.findLast((prompt) => prompt.includes('Regarde le projet')) ?? '';
    expect(turn).toContain('read_file');
    expect(turn).toContain(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('« Nouveau projet… » left without a project: the next project made takes no discussion with it (review of phase 9)', async ({ launch }) => {
  const folder = await mkdtemp(join(tmpdir(), 'spanwise-'));
  try {
    const { page } = await launch({ project: false, engine: { responder: () => 'Entendu.' }, env: { BONAPARTE_E2E_PICK_FOLDER: folder } });
    const ui = chat(page);
    await ui.send('Une discussion');
    await expect(ui.replies).toHaveCount(1, { timeout: 15_000 });
    await expect(ui.streamingReplies).toHaveCount(0, { timeout: 15_000 });

    await page.getByRole('button', { name: 'Plus d’actions' }).click();
    await page.getByRole('menuitem', { name: 'Travailler dans un projet…' }).click();
    await page.getByRole('dialog', { name: 'Travailler dans un projet' }).getByRole('button', { name: 'Nouveau projet…' }).click();
    const create = page.getByRole('dialog', { name: 'Nouveau projet' });
    await create.getByRole('button', { name: 'Annuler' }).click();
    await expect(create).toBeHidden();

    // Later, a project made from the sidebar: the discussion stays one.
    const nav = page.getByRole('navigation', { name: 'Projets et conversations', exact: true });
    await nav.getByRole('button', { name: 'Nouveau projet' }).click();
    await create.getByRole('button', { name: 'Choisir un dossier…' }).click();
    await create.getByRole('button', { name: 'Créer le projet' }).click();
    await expect(create).toBeHidden();
    await expect(nav.getByRole('group', { name: /^spanwise-/ })).toBeVisible();
    await expect(nav.getByRole('group', { name: 'Discussions', exact: true })).toContainText('Une discussion');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
