import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './fixtures/app.js';

let launched: LaunchedApp;

test.afterEach(async () => {
  await launched?.close();
});

test('the window is bonaparte, and its composer speaks French', async () => {
  launched = await launchApp();
  await expect(launched.page).toHaveTitle('bonaparte');
  await expect(launched.page.getByPlaceholder('Réponds, ou demande autre chose…')).toBeVisible();
});

test('the composer speaks English when the app does', async () => {
  launched = await launchApp({ locale: 'en' });
  await expect(launched.page.getByPlaceholder('Reply, or ask something else…')).toBeVisible();
});

test('launching the app asks nothing of the engine', async () => {
  let calls = 0;
  launched = await launchApp({
    engine: {
      responder: () => {
        calls += 1;
        return 'ok';
      },
    },
  });
  await expect(launched.page.getByPlaceholder('Réponds, ou demande autre chose…')).toBeVisible();
  expect(calls).toBe(0);
  expect(launched.server.getSlotTokens(0)).toEqual([]);
});
