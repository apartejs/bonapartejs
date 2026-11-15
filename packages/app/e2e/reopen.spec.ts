/**
 * Starting again (task 5.9): by default the app opens on the last
 * conversation; with « reopen the last conversation » off, on a new one.
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';
import { conversationList } from './fixtures/conversations.js';

test('the app opens again on the last conversation', async ({ launch }) => {
  const first = await launch({ engine: { responder: () => 'ok' }, keepData: true });
  await chat(first.page).send('Le parseur des heures se trompe');
  await expect(chat(first.page).replyText).toHaveText('ok', { timeout: 15_000 });
  await first.close();

  const again = await launch({ engine: { responder: () => 'ok' }, dataDir: first.dataDir });
  await expect(chat(again.page).userMessages.first()).toContainText('Le parseur des heures se trompe');
});

test('with « reopen the last conversation » off, the app opens on a new one', async ({ launch }) => {
  const first = await launch({ engine: { responder: () => 'ok' }, keepData: true });
  await chat(first.page).send('Le parseur des heures se trompe');
  await expect(chat(first.page).replyText).toHaveText('ok', { timeout: 15_000 });
  await first.close();

  const again = await launch({ engine: { responder: () => 'ok' }, dataDir: first.dataDir, settings: { reopenLast: false } });
  // The list has read the conversations: had one to be opened, it would be by now.
  await expect(conversationList(again.page).row('Le parseur des heures se trompe')).toBeVisible();
  await again.page.waitForTimeout(500);
  await expect(chat(again.page).userMessages).toHaveCount(0);
});
