/**
 * Several live chats (task 5.5): a reply goes on while the person looks at
 * another conversation, and is there, whole, when they come back; what one
 * chat shows never shows in another; a conversation seen long ago is let go
 * and comes back from storage as it was.
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const LONG = `Première partie. ${'Une phrase de plus pour la réponse longue. '.repeat(25)}Fin de la réponse A.`;

function model(prompt: string): string {
  const user = prompt.slice(prompt.lastIndexOf('<|turn>user'));
  if (user.includes('Raconte longuement')) return LONG;
  if (user.includes('Question B')) return 'Réponse B.';
  const n = /Sujet (\d+)/.exec(user)?.[1];
  return n ? `Réponse au sujet ${n}.` : 'ok';
}

test('a reply goes on in its conversation while the person writes in another, and is whole on the way back', async ({ launch }) => {
  const { page, server } = await launch({ engine: { responder: model, paceMs: 25 } });
  const ui = chat(page);
  const list = page.locator('aparte-conversation-list');
  await ui.send('Raconte longuement');
  await expect(ui.replyText).toContainText('Première partie.', { timeout: 15_000 });
  expect(server.finished).toBe(0);

  // Away, while A is still written: a new conversation, a message there.
  await page.getByRole('button', { name: 'Nouvelle conversation' }).first().click();
  await expect(ui.userMessages).toHaveCount(0);
  await ui.send('Question B');
  await expect(ui.replyText).toHaveText('Réponse B.', { timeout: 30_000 });
  // Nothing of A shows in B.
  await expect(ui.replies).toHaveCount(1);
  await expect(ui.replies.first()).not.toContainText('Première partie.');

  // Back to A: its reply went on, and is whole; the engine never cut it.
  await list.getByRole('button', { name: /Raconte longuement/ }).click();
  await expect(ui.userMessages).toHaveCount(1);
  await expect(ui.replyText).toContainText('Fin de la réponse A.', { timeout: 30_000 });
  await expect(ui.replies).toHaveCount(1);
  expect(server.aborted).toBe(0);
});

test('a conversation seen long ago is let go, and comes back from storage as it was', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: model } });
  const ui = chat(page);
  const list = page.locator('aparte-conversation-list');
  for (let n = 1; n <= 6; n += 1) {
    if (n > 1) await page.getByRole('button', { name: 'Nouvelle conversation' }).first().click();
    await ui.send(`Sujet ${n}`);
    await expect(ui.replyText).toHaveText(`Réponse au sujet ${n}.`, { timeout: 15_000 });
  }
  // The one shown, and the four seen before it: the first has gone.
  await expect(page.locator('.bonaparte-live-chat')).toHaveCount(5);

  await list.getByRole('button', { name: /Sujet 1/ }).click();
  await expect(ui.userMessages).toHaveCount(1);
  await expect(ui.userMessages.first()).toContainText('Sujet 1');
  await expect(ui.replyText).toHaveText('Réponse au sujet 1.');
  await expect(page.locator('.bonaparte-live-chat')).toHaveCount(5);
});
