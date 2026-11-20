/**
 * The title bar is the app's (Paul, 2026-11-19): on Windows and Linux the system's bar is hidden, its buttons drawn
 * over the window's top right corner in the app's colours — its tokens, followed when the look changes — the top
 * strip moves the window, what answers a click stays clickable, and the conversation's header keeps the buttons'
 * place free.
 */

import { tempRepo } from '@aparte/bonaparte-core/testing';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const EDIT = `<|tool_call>call:edit_file{path:${Q}notes.txt${Q},old_string:${Q}first${Q},new_string:${Q}second${Q}}<tool_call|>`;

/** An edit first, then « Fait. » once its result is read. */
function editThenDone(prompt: string): string {
  return prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user') ? 'Fait.' : EDIT;
}

test.skip(process.platform === 'darwin', 'a Mac keeps its own frame');

/** What the page's tokens resolve to, as the window takes them (#rrggbb). */
async function tokens(page: import('@playwright/test').Page): Promise<{ color: string; symbolColor: string }> {
  return page.evaluate(() => {
    const hex = (rgb: string): string =>
      `#${(/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb) ?? [])
        .slice(1, 4)
        .map((part) => Number(part).toString(16).padStart(2, '0'))
        .join('')}`;
    const probe = document.createElement('span');
    document.body.append(probe);
    probe.style.color = 'var(--aparte-bg)';
    const color = hex(getComputedStyle(probe).color);
    probe.style.color = 'var(--aparte-text-muted)';
    const symbolColor = hex(getComputedStyle(probe).color);
    probe.remove();
    return { color, symbolColor };
  });
}

test('the window’s buttons take the app’s colours, and follow its theme', async ({ launch }) => {
  const { app, page } = await launch({ engine: { responder: () => 'ok' } });
  const told = () => app.evaluate(() => (globalThis as { __bonaparteTitleBar?: unknown }).__bonaparteTitleBar ?? null);
  await expect.poll(told).toEqual(await tokens(page));
  const light = await told();
  await page.evaluate(() => {
    document.documentElement.dataset['aparteTheme'] = 'dark';
  });
  await expect.poll(told).toEqual(await tokens(page));
  expect(await told()).not.toEqual(light);
});

test('at the window’s narrowest, a full header still ends before the window’s buttons begin', async ({ launch }) => {
  // The fullest header there is: a project, a conversation on its own branch, the lines it changed, its folder.
  const repo = await tempRepo({ 'notes.txt': 'first\n' });
  try {
    const { app, page } = await launch({ engine: { responder: editThenDone }, env: { BONAPARTE_E2E_PICK_FOLDER: repo.dir } });
    await page.getByRole('button', { name: 'Nouveau projet' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouveau projet' });
    await dialog.getByRole('button', { name: 'Choisir un dossier…' }).click();
    await dialog.getByRole('radio', { name: /Plume/ }).check();
    await dialog.getByRole('button', { name: 'Créer le projet' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('radiogroup', { name: 'Où travaille la conversation' }).getByRole('radio', { name: /Sur sa propre branche/ }).check();
    await page.getByRole('textbox', { name: 'Branche' }).fill('bonaparte/heures');
    await chat(page).send('Change la note');
    await expect(chat(page).replyText).toHaveText('Fait.', { timeout: 15_000 });
    const header = page.locator('.conversation-header');
    await expect(header.getByRole('button', { name: 'Ouvrir le dossier' })).toBeVisible({ timeout: 10_000 });

    // The narrowest with the sidebar open, then the narrowest of all (the sidebar folded).
    for (const width of [1110, 720]) {
      await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setSize(w, 640), width);
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(width + 20);
      await expect(page.getByRole('group', { name: 'Volets' }).getByRole('button').last()).toBeVisible();
      const { lastIcon, controls } = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;top:0;left:env(titlebar-area-x, 0px);width:env(titlebar-area-width, 100vw);height:1px';
        document.body.append(probe);
        const area = probe.getBoundingClientRect();
        probe.remove();
        const buttons = [...document.querySelectorAll('.conversation-header button')].filter((button) => (button as HTMLElement).offsetParent !== null);
        return { lastIcon: Math.max(...buttons.map((button) => button.getBoundingClientRect().right)), controls: area.right };
      });
      // Nothing of the header under the system's buttons (they span the strip right of the title bar's area).
      expect(lastIcon, `at ${width} px`).toBeLessThanOrEqual(controls);
    }
  } finally {
    await repo.remove();
  }
});

test('the top strip moves the window, a button in it stays clickable, and the header keeps the buttons’ place', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  const strip = page.locator('.bonaparte-drag');
  const region = await strip.evaluate((element) => ({
    drag: getComputedStyle(element).getPropertyValue('-webkit-app-region') || getComputedStyle(element).getPropertyValue('app-region'),
    height: element.getBoundingClientRect().height,
  }));
  expect(region.drag).toBe('drag');
  expect(region.height).toBeGreaterThanOrEqual(32);
  const button = page.getByRole('button', { name: 'Nouvelle conversation', exact: true }).first();
  expect(await button.evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-app-region') || getComputedStyle(element).getPropertyValue('app-region'))).toBe('no-drag');
  // The header and the sidebar's top move the window themselves, the title among them (Paul, 2026-11-20: the strip
  // alone did not take everywhere on Windows) — what answers a click in them stays clickable.
  const appRegion = (selector: string) =>
    page.locator(selector).first().evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-app-region') || getComputedStyle(element).getPropertyValue('app-region'));
  expect(await appRegion('.conversation-header__title')).toBe('drag');
  expect(await appRegion('.bonaparte-sidebar__top')).toBe('drag');
  expect(await appRegion('.conversation-header .panel-toggles button')).toBe('no-drag');
  // A menu of the header, and its dialog, are the page's: never a spot that moves the window. A conversation has them.
  await chat(page).send('Bonjour');
  await expect(chat(page).replyText).toHaveText('ok', { timeout: 15_000 });
  expect(await appRegion('.conversation-header .aparte-menu')).toBe('no-drag');
  expect(await appRegion('.conversation-header dialog')).toBe('no-drag');
  // The buttons' place, kept at the header's end: its last icon ends before the system's buttons begin.
  const header = page.locator('.conversation-header');
  const kept = await header.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingRight));
  expect(kept).toBeGreaterThan(100);
});
