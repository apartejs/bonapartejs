/**
 * « Rechercher » (board « Rechercher (Ctrl K) »): Ctrl K opens it, the words
 * find the conversation where they were said — the passage around them,
 * the words marked —, the first result is chosen, the arrows move, Enter
 * opens, Escape closes; the actions start a conversation on the words.
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

test('Ctrl K finds the conversation where the words were said, and opens it', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  const ui = chat(page);
  await ui.send('Le parseur des heures se trompe');
  await expect(ui.replyText).toHaveText('ok', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Nouvelle conversation', exact: true }).click();
  await ui.send('Autre sujet');
  await expect(ui.replyText).toHaveText('ok', { timeout: 15_000 });

  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Rechercher' });
  await expect(palette).toBeVisible();
  await palette.getByRole('combobox', { name: 'Rechercher partout' }).fill('parseur');
  const found = palette.getByRole('option', { name: /parseur/ }).first();
  await expect(found).toBeVisible();
  await expect(found.locator('mark')).toHaveText('parseur');
  await expect(found).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(ui.userMessages.first()).toContainText('Le parseur des heures');
});

test('the actions start a conversation on the words; Escape closes', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  // The window is ready once the composer is: Ctrl K before that reaches no page yet.
  await expect(chat(page).editor).toBeVisible();
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Rechercher' });
  const field = palette.getByRole('combobox', { name: 'Rechercher partout' });
  await field.fill('fuseaux');
  await expect(palette.getByRole('option', { name: /Nouvelle conversation sur « fuseaux »/ })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(palette.getByRole('option', { name: /Nouvelle conversation sur « fuseaux »/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(chat(page).editor).toContainText('fuseaux');

  await page.keyboard.press('Control+K');
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});
