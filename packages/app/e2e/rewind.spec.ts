/**
 * Going back before a message (board « Revenir en arrière », task 7.2): a
 * message of the person's offers « Revenir avant »; the dialog says first
 * what would move — the files, the memory, the commands — with three
 * choices, « Le code et la conversation » by default; « Revenir » takes the
 * message and what followed out of the thread, puts the files back and gives
 * the message back to the composer; a banner says it, with « Annuler le
 * retour ». « Brancher » in the header shows the continuation left.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type LaunchedApp, type LaunchOptions } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const write = (path: string, content: string) => `<|tool_call>call:write_file{path:${Q}${path}${Q},content:${Q}${content}${Q}}<tool_call|>`;

function model(prompt: string): string {
  if (prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user')) return 'Fait.';
  const user = prompt.slice(prompt.lastIndexOf('<|turn>user'));
  if (user.includes('Renomme la note')) return write('note.txt', 'v1');
  if (user.includes('Ajoute un export')) return write('note.txt', 'v2') + write('export.csv', 'a;b');
  return 'Autre chose, fait.';
}

/** Two turns: the first writes note.txt, the second changes it and creates export.csv. */
async function twoTurns(launch: (options?: LaunchOptions) => Promise<LaunchedApp>) {
  const launched = await launch({ engine: { responder: model }, settings: { defaultMode: 'plume' } });
  await writeFile(join(launched.home, 'note.txt'), 'v0');
  await chat(launched.page).send('Renomme la note');
  await expect(chat(launched.page).replyText).toHaveText('Fait.', { timeout: 15_000 });
  await chat(launched.page).send('Ajoute un export');
  await expect(chat(launched.page).replyText).toHaveText('Fait.', { timeout: 15_000 });
  await expect.poll(() => readFile(join(launched.home, 'note.txt'), 'utf8')).toBe('v2');
  return launched;
}

/** The second message's « Revenir avant »: the dialog it opens. */
async function goBackBefore(page: LaunchedApp['page']) {
  const message = chat(page).userMessages.nth(1);
  await message.hover();
  await message.getByRole('button', { name: 'Revenir avant' }).click();
  return page.getByRole('dialog', { name: 'Revenir avant « Ajoute un export » ?' });
}

test('« Revenir avant » says what would move, then takes the message and what followed back; « Annuler le retour » puts it all back', async ({ launch }) => {
  const { page, home } = await twoTurns(launch);
  const dialog = await goBackBefore(page);
  await expect(dialog.getByRole('radio', { name: /Le code et la conversation/ })).toBeChecked();
  await expect(dialog).toContainText('2 fichiers reviennent à leur état d’avant : note.txt, export.csv.');
  await expect(dialog).toContainText('Ce qui suivait n’est pas perdu');
  await dialog.getByRole('button', { name: 'Revenir' }).click();

  await expect(chat(page).userMessages).toHaveCount(1);
  await expect(chat(page).editor).toHaveText('Ajoute un export');
  const banner = page.getByRole('status').filter({ hasText: 'Revenu avant « Ajoute un export »' });
  await expect(banner).toContainText('2 fichiers restaurés');
  expect(await readFile(join(home, 'note.txt'), 'utf8')).toBe('v1');
  expect(existsSync(join(home, 'export.csv'))).toBe(false);

  await banner.getByRole('button', { name: 'Annuler le retour' }).click();
  await expect(chat(page).userMessages).toHaveCount(2);
  await expect(banner).toHaveCount(0);
  expect(await readFile(join(home, 'note.txt'), 'utf8')).toBe('v2');
  expect(await readFile(join(home, 'export.csv'), 'utf8')).toBe('a;b');
});

test('« Le code seulement »: the files go back, the conversation stays as it is', async ({ launch }) => {
  const { page, home } = await twoTurns(launch);
  const dialog = await goBackBefore(page);
  await dialog.getByRole('radio', { name: /Le code seulement/ }).check();
  await expect(dialog).toContainText('La conversation ne bouge pas, sa mémoire non plus.');
  await dialog.getByRole('button', { name: 'Revenir' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Code revenu avant « Ajoute un export »' })).toBeVisible();
  await expect(chat(page).userMessages).toHaveCount(2);
  await expect(chat(page).editor).toHaveText('');
  expect(await readFile(join(home, 'note.txt'), 'utf8')).toBe('v1');
});

test('« Brancher » in the header lists the branches; the continuation left is shown again from it', async ({ launch }) => {
  const { page } = await twoTurns(launch);
  const dialog = await goBackBefore(page);
  await dialog.getByRole('radio', { name: /La conversation seulement/ }).check();
  await dialog.getByRole('button', { name: 'Revenir' }).click();
  await expect(chat(page).userMessages).toHaveCount(1);
  await chat(page).send('Autre chose');
  await expect(chat(page).replyText).toHaveText('Autre chose, fait.', { timeout: 15_000 });

  await page.locator('.conversation-header').getByRole('button', { name: 'Brancher' }).click();
  const menu = page.getByRole('menu', { name: 'Branches de la conversation' });
  await expect(menu.getByRole('menuitem')).toHaveCount(2);
  await menu.getByRole('menuitem', { name: /Renomme la note/ }).click();
  await expect(chat(page).userMessages).toHaveCount(2);
  await expect(chat(page).userMessages.nth(1)).toContainText('Ajoute un export');
});

test('an answer asked again is a sibling; the one the person picks is the one the conversation goes on from', async ({ launch }) => {
  let answers = 0;
  const prompts: string[] = [];
  const { page } = await launch({
    engine: {
      responder: (prompt: string) => (prompt.includes('Et la suite') ? 'La suite.' : `Réponse ${(answers += 1)}.`),
      onCompletion: (body) => prompts.push(String(body['prompt'])),
    },
  });
  await chat(page).send('Bonjour');
  await expect(chat(page).replyText).toHaveText('Réponse 1.', { timeout: 15_000 });
  const reply = page.locator('.bonaparte-live-chat:not([hidden]) aparte-chat-bubble[data-role="assistant"]').last();
  await reply.hover();
  await reply.getByRole('button', { name: 'Réessayer' }).click();
  await expect(chat(page).replyText).toHaveText('Réponse 2.', { timeout: 15_000 });
  // Back to the first answer, then on from it.
  await page.locator('.bonaparte-live-chat:not([hidden])').getByRole('button', { name: 'Réponse précédente' }).click();
  await expect(chat(page).replyText).toHaveText('Réponse 1.');
  await chat(page).send('Et la suite ?');
  await expect(chat(page).replyText).toHaveText('La suite.', { timeout: 15_000 });
  const last = prompts.at(-1)!;
  expect(last).toContain('Réponse 1.');
  expect(last).not.toContain('Réponse 2.');
});

test('a message changed starts a branch; the continuation it replaced is found again from the message’s « Brancher »', async ({ launch }) => {
  const { page } = await launch({
    engine: { responder: (prompt: string) => (prompt.slice(prompt.lastIndexOf('<|turn>user')).includes('autrement') ? 'Autre réponse.' : 'Première réponse.') },
  });
  await chat(page).send('Dis bonjour');
  await expect(chat(page).replyText).toHaveText('Première réponse.', { timeout: 15_000 });
  const message = chat(page).userMessages.first();
  await message.hover();
  await message.getByRole('button', { name: 'Modifier le message' }).click();
  const field = message.getByRole('textbox');
  await field.fill('Dis bonjour autrement');
  await message.getByRole('button', { name: 'Envoyer' }).click();
  await expect(chat(page).replyText).toHaveText('Autre réponse.', { timeout: 15_000 });

  const changed = chat(page).userMessages.first();
  await changed.hover();
  await changed.getByRole('button', { name: 'Brancher' }).click();
  const menu = page.getByRole('menu', { name: 'Branches de la conversation' });
  await menu.getByRole('menuitem', { name: /Dis bonjour »/ }).click();
  await expect(chat(page).userMessages.first()).toContainText('Dis bonjour');
  await expect(chat(page).replyText).toHaveText('Première réponse.');
});

test('a message of the person’s says « Revenir avant » and « Brancher » in words, as the board draws them', async ({ launch }) => {
  const { page } = await twoTurns(launch);
  const message = chat(page).userMessages.nth(1);
  await message.hover();
  // Their words, not an icon alone (aparté 1.11, `display`); « Revenir avant » before aparté's own buttons.
  await expect(message.getByRole('button', { name: 'Revenir avant' })).toHaveText('Revenir avant');
  await expect(message.getByRole('button', { name: 'Brancher' })).toHaveText('Brancher');
  await expect(message.getByRole('button').first()).toHaveAccessibleName('Revenir avant');
});
