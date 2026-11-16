/**
 * Being noticed when the window is not in front of the person (task 8.5, board « Notifications et zone de
 * notification »): a reply done, an approval waiting become banners — never while the window is in front, never
 * during « Ne pas déranger »; a banner opens its conversation and gives nothing; the icon and the badge say what
 * waits; the icon's menu lists it. A test run shows none of it: the app hands the test what it would have shown.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';
import { attentionShown, banners, clickBanner, clickTrayItem, setFocused, trayLabels } from './fixtures/window.js';

const Q = '<|"|>';
const EDIT = `<|tool_call>call:edit_file{path:${Q}notes.txt${Q},old_string:${Q}old line${Q},new_string:${Q}new line${Q}}<tool_call|>`;

/** Edits the note when asked about it, « Fait. » once it read a result; else a summary. */
function model(prompt: string): string {
  const user = prompt.lastIndexOf('<|turn>user');
  if (prompt.lastIndexOf('<|tool_response>') > user) return 'Fait.';
  return prompt.slice(user).includes('note') ? EDIT : 'La synthèse est prête.';
}

test('a reply done while the window is not in front: a banner, which opens its conversation', async ({ launch }) => {
  const { app, page } = await launch({ engine: { responder: model } });
  await setFocused(app, false);
  const ui = chat(page);
  await ui.send('Fais la synthèse');
  await expect(ui.replyText).toHaveText('La synthèse est prête.');
  await expect.poll(() => banners(app)).toEqual([{ title: 'Tour fini · Fais la synthèse', body: 'La synthèse est prête.', conversationId: expect.any(String) }]);

  // The person went elsewhere; the banner brings them back to the conversation.
  await page.getByRole('button', { name: 'Nouvelle conversation' }).first().click();
  await expect(ui.replyText).toHaveCount(0);
  await clickBanner(app, 0);
  await expect(ui.replyText).toHaveText('La synthèse est prête.');
});

test('nothing pops up while the window is in front of the person', async ({ launch }) => {
  const { app, page } = await launch({ engine: { responder: model } });
  await setFocused(app, true);
  const ui = chat(page);
  await ui.send('Fais la synthèse');
  await expect(ui.replyText).toHaveText('La synthèse est prête.');
  await page.waitForTimeout(500);
  expect(await banners(app)).toEqual([]);
});

test('an approval waiting: a banner, the icon and the badge say it, the menu lists it — and a banner gives nothing', async ({ launch }) => {
  const { app, page, home } = await launch({ engine: { responder: model } });
  await writeFile(join(home, 'notes.txt'), 'old line\n');
  await setFocused(app, false);
  const ui = chat(page);
  await ui.send('Change la note');
  await expect(page.getByRole('region', { name: 'Demande d’accord' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => banners(app)).toEqual([{ title: 'Attend ton accord · Change la note', body: 'Modifier notes.txt', conversationId: expect.any(String) }]);
  await expect.poll(() => attentionShown(app)).toEqual({ icon: 'waiting', badge: { kind: 'waiting', text: 'bonaparte attend ton accord' } });
  const labels = await trayLabels(app);
  expect(labels[0]).toBe('bonaparte — 1 accord attendu');
  expect(labels).toContain('Change la note — attend ton accord');

  // Elsewhere, then the banner: the conversation, its request still there, nothing written.
  await page.getByRole('button', { name: 'Nouvelle conversation' }).first().click();
  await clickBanner(app, 0);
  await expect(page.getByRole('region', { name: 'Demande d’accord' })).toBeVisible();
  expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('old line\n');

  // Answered in the window: the icon goes back to rest.
  await page.getByRole('region', { name: 'Demande d’accord' }).getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect.poll(() => readFile(join(home, 'notes.txt'), 'utf8'), { timeout: 15_000 }).toBe('new line\n');
  await expect.poll(() => attentionShown(app), { timeout: 10_000 }).toMatchObject({ icon: 'rest', badge: null });
});

test('« Ne pas déranger pendant 1 h » from the icon\'s menu: no banner — what waits is in « À traiter »', async ({ launch }) => {
  const { app, page, home } = await launch({ engine: { responder: model } });
  await writeFile(join(home, 'notes.txt'), 'old line\n');
  await setFocused(app, false);
  await clickTrayItem(app, 'Ne pas déranger pendant 1 h');
  await expect.poll(async () => (await trayLabels(app)).some((label) => label.startsWith('Ne pas déranger · jusqu’à '))).toBe(true);

  await chat(page).send('Change la note');
  await expect(page.getByRole('region', { name: 'Demande d’accord' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Nouvelle conversation' }).first().click();
  await expect(page.getByRole('button', { name: '1 à traiter' })).toBeVisible({ timeout: 10_000 });
  // The badge still says it; no banner.
  await expect.poll(() => attentionShown(app)).toMatchObject({ icon: 'waiting' });
  expect(await banners(app)).toEqual([]);

  // The icon's menu opens the conversation that waits.
  await clickTrayItem(app, 'Change la note');
  await expect(page.getByRole('region', { name: 'Demande d’accord' })).toBeVisible();
});
