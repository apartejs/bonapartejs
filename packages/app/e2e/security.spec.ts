import { expect, test } from './fixtures/app.js';

// A name that can never resolve (RFC 6761): were a guard to fail, the test
// would still send nothing to anyone.
const ELSEWHERE = 'https://elsewhere.invalid/';

test('the page has no Node, and only the narrow bridge', async ({ launch }) => {
  const { page } = await launch();
  expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
  expect(await page.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe('undefined');
  expect(await page.evaluate(() => Object.keys((globalThis as { bonaparte?: object }).bonaparte ?? {}))).toEqual([
    'invoke',
  ]);
});

test('the window never navigates out of the app', async ({ launch }) => {
  const launched = await launch();
  const { app, page } = launched;
  const before = page.url();
  // By script, so that nothing in the page gets a chance to refuse first: this
  // is the main process's lock. Another site, then another address of the app
  // itself — that one needs no network: were the lock to fail, the window
  // would be there at once, however slow a name is to resolve.
  await page.evaluate((url) => {
    location.href = url;
  }, ELSEWHERE);
  await page.evaluate(() => {
    location.href = 'bonaparte://app/elsewhere.html';
  });
  await page.waitForTimeout(500);
  // Read in the main process: no other document was loaded, or even tried.
  // (After a refusal, Playwright still believes a navigation is pending and
  // makes every `expect(locator)` wait for it: ask with `evaluate` instead.)
  expect(await launched.navigations()).toEqual([]);
  expect(page.url()).toBe(before);
  expect(await page.evaluate(() => document.title)).toBe('bonaparte');
  // And it opens no other window.
  await page.evaluate((url) => {
    window.open(url);
  }, ELSEWHERE);
  await page.waitForTimeout(300);
  expect(app.windows()).toHaveLength(1);
});

test('the agent endpoint refuses a body that is not JSON', async ({ launch }) => {
  const { page } = await launch();
  const status = await page.evaluate(async () => {
    const response = await fetch('bonaparte://app/agent/c/x', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
    });
    return response.status;
  });
  expect(status).toBe(415);
});

test('a file the app does not have is a plain 404', async ({ launch }) => {
  const { page } = await launch();
  const status = await page.evaluate(async () => {
    const response = await fetch('bonaparte://app/assets/no-such-file.js');
    return response.status;
  });
  expect(status).toBe(404);
});

test('the bridge refuses a channel that does not exist', async ({ launch }) => {
  const { page } = await launch();
  const outcome = await page.evaluate(async () => {
    const bridge = (globalThis as unknown as { bonaparte: { invoke(name: string, input: unknown): Promise<unknown> } })
      .bonaparte;
    return bridge.invoke('no.such.channel', {}).then(
      () => 'answered',
      () => 'refused',
    );
  });
  expect(outcome).toBe('refused');
});
