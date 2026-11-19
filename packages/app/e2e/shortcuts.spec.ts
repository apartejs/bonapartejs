/**
 * The shortcuts (task 12.1, board « Réglages · Raccourcis »), end to end: each default runs its action from
 * anywhere in the window; the page lists them by group; a click captures new keys, a conflict is said and refused,
 * and what was changed comes back after a restart.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const LONG_REPLY = Array.from({ length: 200 }, (_, index) => `mot${index}`).join(' ');
const title = (page: Page) => page.locator('.conversation-header__title');

async function openShortcuts(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: 'Raccourcis' }).click();
}

test('the conversations’ keys: Ctrl N starts one, Ctrl ↑ ↓ go from one to the other', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  const ui = chat(page);
  await ui.send('Première question');
  await expect(ui.replies).toHaveCount(1, { timeout: 15_000 });
  await page.keyboard.press('Control+N');
  await expect(ui.replies).toHaveCount(0);
  await ui.send('Seconde question');
  await expect(ui.replies).toHaveCount(1, { timeout: 15_000 });
  // The title comes from the first message once the reply is kept: slower on a loaded machine.
  await expect(title(page)).toHaveText('Seconde question', { timeout: 15_000 });
  await expect(page.locator('.bonaparte-conversations [data-conv-id]')).toHaveCount(2, { timeout: 15_000 });
  // The rows' order is the list's (the one changed last first): a title kept late may move the first one up.
  const secondFirst = ((await page.locator('.bonaparte-conversations [data-conv-id]').first().textContent()) ?? '').includes('Seconde');
  await page.keyboard.press(secondFirst ? 'Control+ArrowDown' : 'Control+ArrowUp');
  await expect(title(page)).toHaveText('Première question');
  await page.keyboard.press(secondFirst ? 'Control+ArrowUp' : 'Control+ArrowDown');
  await expect(title(page)).toHaveText('Seconde question');
});

test('the agent’s keys: Ctrl Maj M changes the mode, Échap stops a reply, Ctrl Alt Z offers to go back', async ({ launch }) => {
  const { page, server } = await launch({ engine: { responder: () => LONG_REPLY, paceMs: 50 } });
  const ui = chat(page);
  await expect(ui.modeShown).toHaveText('Répétition');
  await page.keyboard.press('Control+Shift+M');
  await expect(ui.modeShown).toHaveText('Plume');

  // In the composer, aparté's own stop key (aparté 1.14, apartejs/aparte#264).
  await expect(page.locator('.bonaparte-live-chat:not([hidden]) aparte-composer')).toHaveAttribute('stop-key', 'Escape');
  await ui.send('Raconte');
  await expect.poll(async () => ((await ui.replyText.textContent()) ?? '').length).toBeGreaterThanOrEqual(12);
  await ui.editor.click();
  await page.keyboard.press('Escape');
  await expect.poll(() => server.aborted, { timeout: 2_000 }).toBe(1);
  await expect(ui.streamingReplies).toHaveCount(0);

  // Elsewhere in the window, the app's own listener.
  await ui.send('Encore');
  await expect.poll(async () => ((await ui.replyText.textContent()) ?? '').length).toBeGreaterThanOrEqual(12);
  await page.getByRole('button', { name: 'Rechercher dans les conversations' }).focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => server.aborted, { timeout: 2_000 }).toBe(2);
  await expect(ui.streamingReplies).toHaveCount(0);

  await page.keyboard.press('Control+Alt+Z');
  await expect(page.getByRole('dialog', { name: 'Revenir avant « Encore » ?' })).toBeVisible();
});

test('Échap on a page over the conversation never stops the reply it hides (review 12)', async ({ launch }) => {
  const { page, server } = await launch({ engine: { responder: () => LONG_REPLY, paceMs: 50 } });
  const ui = chat(page);
  await ui.send('Raconte');
  await expect.poll(async () => ((await ui.replyText.textContent()) ?? '').length).toBeGreaterThanOrEqual(12);
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Réglages' });
  await nav.getByRole('link', { name: 'Général' }).focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+J');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  expect(server.aborted).toBe(0);
  await page.keyboard.press('Control+J');
  await expect(ui.streamingReplies).toHaveCount(1);
});

test('the panes’ keys: Ctrl Maj D, Ctrl ` and Ctrl Maj B open their pane', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await expect(chat(page).editor).toBeVisible();
  await page.keyboard.press('Control+Shift+D');
  await expect(page.getByRole('region', { name: 'Changements', exact: true })).toBeVisible();
  await page.keyboard.press('Control+`');
  await expect(page.getByRole('region', { name: 'Terminal', exact: true })).toBeVisible();
  await page.keyboard.press('Control+Shift+B');
  await expect(page.getByRole('region', { name: 'Navigateur', exact: true })).toBeVisible();
});

test('the Raccourcis page: a click captures new keys, a conflict is said and refused, and the change survives a restart', async ({ launch }) => {
  const first = await launch({ engine: { responder: () => 'ok' }, keepData: true });
  const page = first.page;
  await expect(chat(page).editor).toBeVisible();
  await openShortcuts(page);
  for (const group of ['Conversations', 'Avec l’agent', 'Volets']) await expect(page.getByRole('region', { name: group })).toBeVisible();
  const mode = page.getByRole('button', { name: /^Changer de mode/ });
  await expect(mode).toContainText('Ctrl');
  // Sending is aparté's own key: shown, not changed here.
  await expect(page.getByRole('button', { name: /^Envoyer · nouvelle ligne/ })).toHaveCount(0);
  await expect(page.locator('.shortcut-row', { hasText: 'Envoyer · nouvelle ligne' })).toContainText('Entrée');

  await mode.click();
  await expect(mode).toContainText('Appuie sur la nouvelle touche…');
  // A key without Ctrl or Alt would fire as the person types: refused, said (review 12).
  await page.keyboard.press('n');
  await expect(page.locator('.shortcut-row', { hasText: 'Changer de mode' })).toContainText('Un raccourci commence par Ctrl ou Alt');
  await expect(mode).toContainText('Ctrl');
  await mode.click();
  await page.keyboard.press('Control+K');
  await expect(page.locator('.shortcut-row', { hasText: 'Changer de mode' })).toContainText('Déjà pris par « Rechercher partout »');
  // Nothing ran while the key was captured: the search did not open.
  await expect(page.getByRole('dialog', { name: 'Rechercher' })).toHaveCount(0);
  await mode.click();
  await page.keyboard.press('Control+Alt+M');
  await expect(mode).toContainText('Alt');
  await expect(mode).not.toContainText('Appuie sur la nouvelle touche…');

  await page.getByRole('link', { name: 'Conversations' }).click();
  const ui = chat(page);
  await expect(ui.modeShown).toHaveText('Répétition');
  await page.keyboard.press('Control+Shift+M');
  await expect(ui.modeShown).toHaveText('Répétition');
  await page.keyboard.press('Control+Alt+M');
  await expect(ui.modeShown).toHaveText('Plume');

  const main = first.app.process();
  const exited = new Promise<void>((resolve) => main.once('exit', () => resolve()));
  await first.app.evaluate(({ app }) => app.quit()).catch(() => undefined);
  await exited;
  await first.close();
  const second = await launch({ engine: { responder: () => 'ok' }, dataDir: first.dataDir });
  await expect(chat(second.page).editor).toBeVisible();
  await openShortcuts(second.page);
  await expect(second.page.getByRole('button', { name: /^Changer de mode/ })).toContainText('Alt');
});
