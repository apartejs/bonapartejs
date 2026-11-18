/**
 * Commenting the diff (board « Commenter le diff », task 6.5): a click on a
 * line's number opens a field under it; the comment waits there, pending;
 * the footer counts them; one can be changed; « Envoyer à l'agent » sends
 * them all in one message, one turn; « Tout effacer » takes them away.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type LaunchedApp, type LaunchOptions } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';
import { diffView } from './fixtures/diff.js';

const Q = '<|"|>';
const EDIT = `<|tool_call>call:edit_file{path:${Q}notes.txt${Q},old_string:${Q}first${Q},new_string:${Q}premier${Q}}<tool_call|>`;
const WRITE = `<|tool_call>call:write_file{path:${Q}new.ts${Q},content:${Q}export const a = 1;\nexport const b = 2;\n${Q}}<tool_call|>`;

function model(prompt: string): string {
  const user = prompt.slice(prompt.lastIndexOf('<|turn>user'));
  if (user.includes('commentaires sur le diff')) return 'Je reprends les trois.';
  return prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user') ? 'Fait.' : EDIT + WRITE;
}

async function changed(launch: (options?: LaunchOptions) => Promise<LaunchedApp>, prompts: string[]) {
  const launched = await launch({
    engine: { responder: model, onCompletion: (body) => prompts.push(String(body['prompt'])) },
    settings: { defaultMode: 'plume' },
  });
  await writeFile(join(launched.home, 'notes.txt'), 'first\nsecond\n');
  await chat(launched.page).send('Change la note');
  await expect(chat(launched.page).replyText).toHaveText('Fait.', { timeout: 15_000 });
  await launched.page.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Changements', exact: true }).click();
  return { ...launched, pane: launched.page.getByRole('region', { name: 'Changements', exact: true }) };
}

async function comment(pane: ReturnType<typeof diffView>, side: 'old' | 'new', line: number, text: string) {
  await pane.lineNumber(side, line).click();
  await pane.commentField.fill(text);
  await pane.commentField.press('Control+Enter');
}

test('a comment being written stays as the app renders again: the same field, its words (aparté 1.12.1, apartejs/aparte#253)', async ({ launch }) => {
  const { page, pane } = await changed(launch, []);
  const notes = diffView(pane.getByRole('region', { name: 'notes.txt', exact: true }));
  await comment(notes, 'new', 1, 'Garde le mot anglais.');
  await notes.lineNumber('new', 2).click();
  await notes.commentField.fill('En cours d’écriture');
  await notes.commentField.evaluate((field) => Object.assign(field, { keptAcross: true }));
  const row = notes.lineNumber('new', 1);
  await row.evaluate((number) => Object.assign(number, { keptAcross: true }));
  // Anything the app draws again hands the pane its comments again: here, the sidebar folded and unfolded.
  await page.getByRole('button', { name: 'Réduire la barre latérale' }).click();
  await page.getByRole('button', { name: 'Déplier la barre latérale' }).click();
  await expect(page.getByRole('button', { name: 'Réduire la barre latérale' })).toBeVisible();
  const field = await notes.commentField.evaluate((element) => ({
    same: (element as unknown as { keptAcross?: boolean }).keptAcross === true,
    value: (element as HTMLTextAreaElement).value,
  }));
  expect(field).toEqual({ same: true, value: 'En cours d’écriture' });
  // The rows too: the same elements (a text selected in the code stays selected).
  expect(await row.evaluate((number) => (number as unknown as { keptAcross?: boolean }).keptAcross === true)).toBe(true);
});

test('comments wait under their lines, counted; one changes; they leave together, in one message, one turn', async ({ launch }) => {
  const prompts: string[] = [];
  const { page, pane } = await changed(launch, prompts);
  await expect(pane).toContainText('Clique sur un numéro de ligne pour la commenter.');
  const notes = diffView(pane.getByRole('region', { name: 'notes.txt', exact: true }));
  const created = diffView(pane.getByRole('region', { name: 'new.ts', exact: true }));

  await comment(notes, 'new', 1, 'Garde le mot anglais.');
  await expect(notes.comments).toContainText('Garde le mot anglais.');
  const footer = pane.locator('.changes-pane__review');
  await expect(footer).toContainText('1 commentaire prêt, sur 1 fichier');
  await comment(created, 'new', 1, 'Nomme-la mieux.');
  await comment(created, 'new', 2, 'Inutile.');
  await expect(footer).toContainText('3 commentaires prêts, sur 2 fichiers');

  await footer.getByRole('button', { name: 'Modifier le commentaire sur new.ts:2' }).click();
  await footer.getByRole('textbox').fill('Retire-la.');
  await footer.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(created.comments.filter({ hasText: 'Retire-la.' })).toHaveCount(1);
  await expect(created.comments.filter({ hasText: 'Inutile.' })).toHaveCount(0);

  const before = prompts.length;
  await footer.getByRole('button', { name: 'Envoyer à l’agent' }).click();
  await expect(chat(page).replyText).toHaveText('Je reprends les trois.', { timeout: 15_000 });
  expect(prompts.length).toBe(before + 1);
  const sent = prompts.at(-1)!.slice(prompts.at(-1)!.lastIndexOf('<|turn>user'));
  expect(sent).toContain('notes.txt:1 — Garde le mot anglais.');
  expect(sent).toContain('new.ts:1 — Nomme-la mieux.');
  expect(sent).toContain('new.ts:2 — Retire-la.');
  await expect(footer).toHaveCount(0);
  await expect(chat(page).userMessages.last()).toContainText('3 commentaires sur le diff');
});

test('« Tout effacer » takes the comments away, and nothing leaves', async ({ launch }) => {
  const prompts: string[] = [];
  const { pane } = await changed(launch, prompts);
  const notes = diffView(pane.getByRole('region', { name: 'notes.txt', exact: true }));
  await comment(notes, 'new', 1, 'Garde le mot anglais.');
  const before = prompts.length;
  await pane.locator('.changes-pane__review').getByRole('button', { name: 'Tout effacer' }).click();
  await expect(pane.locator('.changes-pane__review')).toHaveCount(0);
  await expect(notes.comments).toHaveCount(0);
  expect(prompts.length).toBe(before);
});
