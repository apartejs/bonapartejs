/**
 * The window is one page. A reply may hold links — a coding agent names files
 * all the time — and a click on one must never replace the conversation, which
 * lives in that page.
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

test('a link in a reply never takes the window away from the conversation', async ({ launch }) => {
  const reply = 'Regarde [package.json](package.json), puis [la racine](/) et [le site](https://elsewhere.invalid/).';
  const launched = await launch({ engine: { responder: () => reply } });
  const { app, page } = launched;
  const ui = chat(page);
  const address = page.url();

  await ui.send('Quelle version ?');
  await expect(ui.replyText).toContainText('Regarde package.json');
  await expect(ui.streamingReplies).toHaveCount(0);

  for (const name of ['package.json', 'la racine', 'le site']) {
    await ui.replyText.getByRole('link', { name }).click();
    // Still there after the click: the page was not replaced.
    await expect(ui.replyText).toContainText('Regarde package.json');
  }

  // The conversation goes on, in the same page.
  await ui.send('Merci');
  await expect(ui.replies).toHaveCount(2);
  await expect(ui.userMessages).toHaveCount(2);

  expect(await launched.navigations()).toEqual([]);
  expect(page.url()).toBe(address);
  expect(app.windows()).toHaveLength(1);
});
