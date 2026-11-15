/**
 * Deleting a conversation (task 5.9): asked first, in the row's menu, with
 * what goes — its messages, its memory, the copies of the files kept to go
 * back —; then it is gone everywhere: the list, and its folder on disk.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';
import { conversationList } from './fixtures/conversations.js';

test('« Supprimer » asks first, says what goes, then the conversation is gone everywhere', async ({ launch }) => {
  const { page, dataDir } = await launch({ engine: { responder: () => 'ok' } });
  const ui = chat(page);
  await ui.send('À supprimer');
  await expect(ui.replyText).toHaveText('ok', { timeout: 15_000 });
  const folders = async (): Promise<number> =>
    (await readdir(join(dataDir, 'conversations'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).length;
  expect(await folders()).toBe(1);

  const sidebar = conversationList(page);
  await sidebar.openMenu('À supprimer');
  await page.getByRole('menuitem', { name: 'Supprimer' }).click();
  const question = page.getByRole('dialog', { name: /Supprimer « À supprimer »/ });
  await expect(question).toBeVisible();
  await expect(question).toContainText('sa mémoire');
  await question.getByRole('button', { name: 'Supprimer' }).click();

  await expect(sidebar.row('À supprimer')).toHaveCount(0);
  await expect.poll(folders).toBe(0);
});
