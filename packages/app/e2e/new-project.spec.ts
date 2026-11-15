/**
 * A project is made from a folder (board « Nouveau projet »): the person
 * chooses the folder, the dialog says what it holds — the repository and its
 * branch, the scripts, the instructions —, the name comes from the folder,
 * the mode is chosen; nothing is written in the folder. A conversation
 * started then works in the project: its folder, its mode, its instructions.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const EDIT = `<|tool_call>call:edit_file{path:${Q}notes.txt${Q},old_string:${Q}first${Q},new_string:${Q}second${Q}}<tool_call|>`;

function model(prompt: string): string {
  const user = prompt.lastIndexOf('<|turn>user');
  if (prompt.lastIndexOf('<|tool_response>') > user) return 'Fait.';
  return prompt.slice(user).includes('note') ? EDIT : 'ok';
}

test('a project is made from a folder — what it holds said first, nothing written there — and a conversation started then works in it', async ({ launch }) => {
  const folder = await mkdtemp(join(tmpdir(), 'spanwise-'));
  try {
    await mkdir(join(folder, '.git'));
    await writeFile(join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(join(folder, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.32.1', scripts: { dev: 'vite', test: 'vitest' } }));
    await writeFile(join(folder, 'AGENTS.md'), 'Indent with tabs in this project.\n');
    await writeFile(join(folder, 'notes.txt'), 'first\n');
    const before = (await readdir(folder)).sort();

    const prompts: string[] = [];
    const { page } = await launch({
      engine: { responder: model, onCompletion: (body) => prompts.push(String(body['prompt'])) },
      env: { BONAPARTE_E2E_PICK_FOLDER: folder },
    });
    await page.getByRole('button', { name: 'Nouveau projet' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouveau projet' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Choisir un dossier…' }).click();

    await expect(dialog).toContainText(folder);
    await expect(dialog).toContainText('Un dépôt git, sur main');
    await expect(dialog).toContainText('avec pnpm');
    await expect(dialog).toContainText('dev, test');
    await expect(dialog).toContainText('AGENTS.md');
    await expect(dialog.getByRole('textbox', { name: 'Nom' })).toHaveValue(/^spanwise-/);
    await dialog.getByRole('radio', { name: /Plume/ }).check();
    await dialog.getByRole('button', { name: 'Créer le projet' }).click();
    await expect(dialog).toBeHidden();
    expect((await readdir(folder)).sort()).toEqual(before);

    // A conversation started now is the project's: its folder, its mode (Plume: the edit passes), its instructions.
    await expect(chat(page).modeShown).toHaveText('Plume');
    await chat(page).send('Change la note');
    await expect.poll(() => readFile(join(folder, 'notes.txt'), 'utf8'), { timeout: 15_000 }).toBe('second\n');
    await expect(page.getByRole('region', { name: 'Demande d’accord' })).toHaveCount(0);
    expect(prompts.find((prompt) => prompt.includes('Change la note'))).toContain('Indent with tabs in this project.');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
