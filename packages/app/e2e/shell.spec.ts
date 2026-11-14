import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const PLACEHOLDER_FR = 'Réponds, ou demande autre chose…';
const PLACEHOLDER_EN = 'Reply, or ask something else…';

test('the window is bonaparte, and it speaks French', async ({ launch }) => {
  const { page } = await launch();
  await expect(page).toHaveTitle('bonaparte');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  // Our string: the composer's placeholder is its accessible name.
  await expect(chat(page).composer(PLACEHOLDER_FR)).toBeVisible();
  // aparté's own strings follow the app's language.
  await expect(page.getByRole('button', { name: 'Envoyer' })).toBeVisible();
});

test('the window speaks English when the app does', async ({ launch }) => {
  const { page } = await launch({ locale: 'en' });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(chat(page).composer(PLACEHOLDER_EN)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});

test('the line of an empty conversation sits above the composer, on its axis', async ({ launch }) => {
  const { page } = await launch();
  const ui = chat(page);
  await expect(ui.composer(PLACEHOLDER_FR)).toBeVisible();
  const composer = (await ui.composerBox.boundingBox())!;
  // The text itself, not its paragraph: a paragraph as wide as the window is
  // centred whatever its text does.
  const text = await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('.bonaparte-empty')!);
    const box = range.getBoundingClientRect();
    return { left: box.left, width: box.width, bottom: box.bottom };
  });
  expect(Math.abs(text.left + text.width / 2 - (composer.x + composer.width / 2))).toBeLessThanOrEqual(2);
  expect(text.bottom).toBeLessThanOrEqual(composer.y);
});

test('launching the app asks nothing of the engine', async ({ launch }) => {
  let calls = 0;
  const { page, server } = await launch({
    engine: {
      responder: () => {
        calls += 1;
        return 'ok';
      },
    },
  });
  await expect(chat(page).composer(PLACEHOLDER_FR)).toBeVisible();
  expect(calls).toBe(0);
  expect(server.getSlotTokens(0)).toEqual([]);
});

test('a test run keeps its window off the screen, and off the graphics card', async ({ launch }) => {
  const { app, page } = await launch();
  await expect(chat(page).composer(PLACEHOLDER_FR)).toBeVisible();
  // The window is placed when it is ready to show: ask until it is.
  await expect
    .poll(() =>
      app.evaluate(({ app: electronApp, BrowserWindow }) => {
        const windows = BrowserWindow.getAllWindows();
        const [x = 0, y = 0] = windows[0]?.getPosition() ?? [];
        return {
          windows: windows.length,
          focused: windows.some((window) => window.isFocused()),
          hardwareAcceleration: electronApp.isHardwareAccelerationEnabled(),
          // Windows is where a window can take the foreground from a full-screen
          // app, and where opacity and an off-screen position are honoured.
          hidden: process.platform !== 'win32' || (windows[0]?.getOpacity() === 0 && x < -10_000 && y < -10_000),
        };
      }),
    )
    .toEqual({ windows: 1, focused: false, hardwareAcceleration: false, hidden: true });
});
