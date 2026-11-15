/**
 * Closing the window (task 5.9): by default it goes to the notification area —
 * a reply keeps going, the engine is not cut, and the icon brings the window
 * back with the reply finished. Without « close to the tray », closing quits.
 * « Quitter » in the notification area quits.
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';
import { clickTrayItem, closeWindow, windowShown } from './fixtures/window.js';

const LONG_REPLY = Array.from({ length: 60 }, (_, index) => `mot${index}`).join(' ');

test('closing the window hides it: the reply goes on, and the tray brings the window back', async ({ launch }) => {
  const { app, page, server } = await launch({ engine: { responder: () => LONG_REPLY, paceMs: 30 } });
  const ui = chat(page);
  await ui.send('Raconte');
  await expect.poll(async () => ((await ui.replyText.textContent()) ?? '').length).toBeGreaterThanOrEqual(12);

  closeWindow(app);
  await expect.poll(() => windowShown(app)).toBe(false);
  // Hidden, not gone: the engine finishes the reply, nobody cut it.
  await expect.poll(() => server.finished, { timeout: 15_000 }).toBe(1);
  expect(server.aborted).toBe(0);

  await clickTrayItem(app, 'Ouvrir bonaparte');
  await expect.poll(() => windowShown(app)).toBe(true);
  await expect(ui.replyText).toHaveText(LONG_REPLY, { timeout: 15_000 });
});

test('without « close to the tray », closing the window quits the app', async ({ launch }) => {
  const { app } = await launch({ settings: { closeToTray: false } });
  const closed = app.waitForEvent('close');
  closeWindow(app);
  await closed;
});

test('« Quitter » in the notification area quits the app', async ({ launch }) => {
  const { app } = await launch();
  const closed = app.waitForEvent('close');
  await clickTrayItem(app, 'Quitter');
  await closed;
});
