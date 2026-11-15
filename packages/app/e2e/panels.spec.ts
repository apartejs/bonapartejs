/**
 * The panes beside the conversation (board « Conversation au travail »,
 * task 6.2): three icons in the header, named on hover; each opens or closes
 * its pane; the panes stack, the terminal 300 px high when another is open;
 * Changements opens by itself when a change waits for the person (the
 * default); under 1 100 px a pane goes over the conversation.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const EDIT = `<|tool_call>call:edit_file{path:${Q}notes.txt${Q},old_string:${Q}first${Q},new_string:${Q}second${Q}}<tool_call|>`;

test('three icons open and close their panes; the panes stack, the terminal 300 px under another', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await expect(chat(page).editor).toBeVisible();
  const toggles = page.getByRole('group', { name: 'Volets' });
  await expect(toggles.getByRole('button')).toHaveCount(3);
  const files = toggles.getByRole('button', { name: 'Fichiers', exact: true });
  const terminal = toggles.getByRole('button', { name: 'Terminal', exact: true });
  // Nothing open at first; a name on hover.
  await expect(page.getByRole('region', { name: 'Fichiers', exact: true })).toHaveCount(0);
  await files.hover();
  await expect(toggles.locator('.aparte-tooltip', { hasText: 'Fichiers' })).toBeVisible();

  await files.click();
  await expect(files).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Fichiers', exact: true })).toBeVisible();
  await terminal.click();
  const terminalPane = page.getByRole('region', { name: 'Terminal', exact: true });
  await expect(terminalPane).toBeVisible();
  // Stacked: the files above, the terminal under them, 300 px high.
  const [above, under] = await Promise.all([
    page.getByRole('region', { name: 'Fichiers', exact: true }).boundingBox(),
    terminalPane.boundingBox(),
  ]);
  expect(under!.y).toBeGreaterThanOrEqual(above!.y + above!.height - 1);
  expect(Math.round(under!.height)).toBe(300);

  // Closed by its own cross: the terminal fills the column.
  await page.getByRole('button', { name: 'Fermer les fichiers' }).click();
  await expect(files).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await terminalPane.boundingBox())!.height).toBeGreaterThan(400);
  await terminal.click();
  await expect(terminalPane).toHaveCount(0);
});

test('a change waiting for the person puts a mark on Changements, and opens it by itself', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: () => EDIT } });
  await writeFile(join(home, 'notes.txt'), 'first\n');
  await chat(page).send('Change la note');
  await expect(page.getByRole('region', { name: 'Demande d’accord' })).toBeVisible({ timeout: 15_000 });
  const toggles = page.getByRole('group', { name: 'Volets' });
  await expect(toggles.getByRole('button', { name: 'Changements, 1 en attente' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Changements', exact: true })).toBeVisible();
});

test('with « never », the mark says it, and nothing opens by itself', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: () => EDIT }, settings: { autoOpenPanel: 'never' } });
  await writeFile(join(home, 'notes.txt'), 'first\n');
  await chat(page).send('Change la note');
  await expect(page.getByRole('region', { name: 'Demande d’accord' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Changements, 1 en attente' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('region', { name: 'Changements', exact: true })).toHaveCount(0);
});

test('under 1 100 px a pane goes over the conversation, one at a time, and its scrim closes it', async ({ launch }) => {
  const { app, page } = await launch({ engine: { responder: () => 'ok' } });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1000, 760));
  const toggles = page.getByRole('group', { name: 'Volets' });
  await toggles.getByRole('button', { name: 'Fichiers', exact: true }).click();
  const over = page.getByRole('region', { name: 'Fichiers, par-dessus la conversation' });
  await expect(over).toBeVisible();
  const [pane, conversation] = await Promise.all([over.boundingBox(), page.locator('.bonaparte-conversation').boundingBox()]);
  // Over it, not beside it: the conversation keeps its whole width.
  expect(pane!.x).toBeLessThan(conversation!.x + conversation!.width);
  expect(pane!.x + pane!.width).toBeGreaterThan(conversation!.x + conversation!.width - 2);
  // The last one opened wins.
  await toggles.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Terminal, par-dessus la conversation' })).toBeVisible();
  await expect(over).toHaveCount(0);
  await page.locator('.bonaparte-panes__scrim').click({ position: { x: 10, y: 10 } });
  await expect(page.getByRole('region', { name: /par-dessus la conversation/ })).toHaveCount(0);
});
