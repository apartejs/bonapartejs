/**
 * One app at a time (task 5.9): launching bonaparte again brings the window
 * of the one already running back, and the second launch quits — one engine,
 * one memory, never two apps writing the same conversations.
 */

import { expect, test } from './fixtures/app.js';
import { closeWindow, windowShown } from './fixtures/window.js';

test('a second launch brings the first window back, and quits', async ({ launch }) => {
  const { app, launchAgain } = await launch();
  closeWindow(app);
  await expect.poll(() => windowShown(app)).toBe(false);

  expect(await launchAgain()).toBe(0);

  await expect.poll(() => windowShown(app)).toBe(true);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});
