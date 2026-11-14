import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './fixtures/app.js';

let launched: LaunchedApp;

test.afterEach(async () => {
  await launched?.close();
});

test('the page has no Node, and only the narrow bridge', async () => {
  launched = await launchApp();
  const page = launched.page;
  expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
  expect(await page.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe('undefined');
  expect(await page.evaluate(() => Object.keys((globalThis as { bonaparte?: object }).bonaparte ?? {}))).toEqual([
    'invoke',
  ]);
});

test('the window never navigates out of the app', async () => {
  launched = await launchApp();
  const page = launched.page;
  const before = page.url();
  await page.evaluate(() => {
    location.href = 'https://example.com/';
  });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(before);
  // And it opens no other window.
  await page.evaluate(() => window.open('https://example.com/'));
  await page.waitForTimeout(300);
  expect(launched.app.windows()).toHaveLength(1);
});

test('the agent endpoint refuses a body that is not JSON', async () => {
  launched = await launchApp();
  const status = await launched.page.evaluate(async () => {
    const response = await fetch('bonaparte://app/agent/c/x', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
    });
    return response.status;
  });
  expect(status).toBe(415);
});

test('the bridge refuses a channel that does not exist', async () => {
  launched = await launchApp();
  const outcome = await launched.page.evaluate(async () => {
    const bridge = (globalThis as unknown as { bonaparte: { invoke(name: string, input: unknown): Promise<unknown> } })
      .bonaparte;
    return bridge.invoke('no.such.channel', {}).then(
      () => 'answered',
      () => 'refused',
    );
  });
  expect(outcome).toBe('refused');
});
