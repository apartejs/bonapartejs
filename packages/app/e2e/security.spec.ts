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
  const { app, page } = await launch();
  const before = page.url();
  await page.evaluate((url) => {
    location.href = url;
  }, ELSEWHERE);
  await page.waitForTimeout(500);
  expect(page.url()).toBe(before);
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
