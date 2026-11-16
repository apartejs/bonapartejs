/**
 * Sub-agents on the screen (task 8.2, board « Une conversation avec des
 * sous-agents au travail »): a line each in the reply — aparté's, its name,
 * its task, its step or its count —; the « Sous-agents » pane, which says where
 * they stand at its top (aparté draws no summary: apartejs/aparte#247), one row
 * each, and opens one with its own thread; the engine card says which works in
 * the engine; a request of a sub-agent names it, and refusing stops only it.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';

function call(name: string, args: Record<string, string>): string {
  return `<|tool_call>call:${name}{${Object.entries(args)
    .map(([key, value]) => `${key}:${Q}${value}${Q}`)
    .join(',')}}<tool_call|>`;
}

const answered = (prompt: string) => prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user');
const isSubagent = (prompt: string) => prompt.includes('You are a sub-agent');
const subagentName = (prompt: string) => /You are a sub-agent named ([^.]+)\./.exec(prompt)?.[1] ?? '';

/** The conversation hands `missions` to sub-agents in one step, then sums up; each sub-agent does `work`, then answers. */
function model(missions: Record<string, string>[], work: (name: string) => string = () => call('read_file', { path: 'notes.txt' })) {
  return (prompt: string): string => {
    if (isSubagent(prompt)) {
      const name = subagentName(prompt);
      return answered(prompt) ? `Rendu de ${name}.` : work(name);
    }
    return answered(prompt) ? 'Synthèse.' : missions.map((mission) => call('run_subagent', mission)).join('');
  };
}

const TWO = [
  { name: 'Lecteur', mission: 'Lis notes.txt.', tools: 'read' },
  { name: 'Explorateur', mission: 'Relis notes.txt.', tools: 'read' },
];

function pane(page: Page) {
  return page.getByRole('region', { name: 'Sous-agents', exact: true });
}

test('a line each in the reply; the pane says where they stand, and opens one with its own thread', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: model(TWO) } });
  await writeFile(join(home, 'notes.txt'), 'une note\n');
  const ui = chat(page);
  await ui.send('Deux pistes');
  await expect(ui.replyText).toHaveText('Synthèse.', { timeout: 20_000 });
  await expect(ui.toolLine('run_subagent')).toHaveCount(2);
  await expect(ui.subagentLine('Lecteur').locator('.aparte-tool-target').first()).toHaveText('Lis notes.txt.');

  await page.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Sous-agents', exact: true }).click();
  await expect(pane(page).locator('.subagents-pane__summary')).toHaveText('2 sous-agents · 2 finis');
  await expect(pane(page).getByRole('img', { name: 'Fini' })).toHaveCount(2);
  await pane(page).getByRole('button', { name: /Explorateur/ }).click();
  const opened = pane(page).getByRole('region', { name: 'Explorateur', exact: true });
  await expect(opened).toContainText('même modèle · lecture seule');
  await expect(opened).toContainText('Relis notes.txt.');
  // Its own thread, drawn by aparté's view: its call, as the reply would show it.
  await expect(opened.locator('aparte-subagent-view')).toContainText('notes.txt');
  await expect(opened).toContainText('Rendu de Explorateur.');
  await expect(opened).toContainText('seul son rendu revient dans ta conversation');
});

test('a line’s « Ouvrir » opens the pane on that sub-agent', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: model(TWO) } });
  await writeFile(join(home, 'notes.txt'), 'une note\n');
  const ui = chat(page);
  await ui.send('Deux pistes');
  await expect(ui.replyText).toHaveText('Synthèse.', { timeout: 20_000 });
  await ui.subagentLine('Lecteur').getByRole('button', { name: 'Ouvrir Lecteur' }).click();
  await expect(pane(page).getByRole('region', { name: 'Lecteur', exact: true })).toContainText('Lis notes.txt.');
  await expect(pane(page).getByRole('button', { name: /Lecteur/ })).toHaveAttribute('aria-pressed', 'true');
});

test('while one works the other waits for the engine, and says so; the engine card says which works', async ({ launch }) => {
  // A slow engine: what each sub-agent writes takes a while.
  const { page, home } = await launch({ engine: { responder: model(TWO), paceMs: 120 } });
  await writeFile(join(home, 'notes.txt'), 'une note\n');
  const ui = chat(page);
  await ui.send('Deux pistes');
  await expect(ui.subagentLine('Explorateur').locator('.aparte-tool-activity')).toHaveText('Attend le moteur', { timeout: 20_000 });
  await expect(page.locator('.engine-card__line')).toHaveText('Occupé : sous-agent Lecteur');
  await page.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Sous-agents', exact: true }).click();
  await expect(pane(page).locator('.subagents-pane__summary')).toHaveText('2 sous-agents · 1 en cours, 1 en file');
  // Then the other; then the conversation again, and the card says it is ready.
  await expect(page.locator('.engine-card__line')).toHaveText('Occupé : sous-agent Explorateur', { timeout: 30_000 });
  await expect(ui.replyText).toHaveText('Synthèse.', { timeout: 30_000 });
  await expect(page.locator('.engine-card__line')).toHaveText(/^Prêt/);
});

test('a request of a sub-agent names it; refusing it stops only it — it returns what it has, and the reply goes on', async ({ launch }) => {
  const missions = [{ name: 'Rédacteur', mission: 'Change la note.', tools: 'all' }];
  const edit = () => call('edit_file', { path: 'notes.txt', old_string: 'une note', new_string: 'deux notes' });
  const { page, home } = await launch({ engine: { responder: model(missions, edit) } });
  await writeFile(join(home, 'notes.txt'), 'une note\n');
  const ui = chat(page);
  await ui.send('Change la note');
  const request = page.getByRole('region', { name: 'Demande d’accord' });
  await expect(request).toBeVisible({ timeout: 20_000 });
  await expect(request).toContainText('demandé par le sous-agent Rédacteur');
  await expect(request).toContainText('Refuser n’arrête que lui : il rend ce qu’il a.');
  await request.getByRole('button', { name: 'Refuser…' }).click();
  await request.getByRole('button', { name: 'Refuser', exact: true }).click();
  await expect(ui.replyText).toHaveText('Synthèse.', { timeout: 20_000 });
  expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('une note\n');
  await page.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Sous-agents', exact: true }).click();
  await expect(pane(page).locator('.subagents-pane__summary')).toHaveText('1 sous-agent · 1 fini');
});

test('« En parallèle » says first what it costs — one slot more, a restart — and keeps nothing before a choice (task 8.3)', async ({ launch }) => {
  const { page } = await launch();
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  const choice = page.getByRole('radiogroup', { name: 'Sous-agents du moteur intégré' });
  await choice.locator('label', { hasText: 'En parallèle' }).click();
  const card = page.locator('.launch-restart');
  await expect(card).toBeVisible();
  await expect(card).toContainText('« Sous-agents du moteur intégré » s’applique au redémarrage du moteur');
  await expect(card).toContainText('un slot de plus pour les sous-agents');
  await card.getByRole('button', { name: 'Annuler' }).click();
  await expect(card).toHaveCount(0);
  await expect(choice.getByRole('radio', { name: 'L’un après l’autre' })).toBeChecked();

  // Kept (no model loaded: for the next load), the choice stays; going back asks again (review of phase 8).
  await choice.locator('label', { hasText: 'En parallèle' }).click();
  await card.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(card).toHaveCount(0);
  await expect(choice.getByRole('radio', { name: 'En parallèle' })).toBeChecked();
  await choice.locator('label', { hasText: 'L’un après l’autre' }).click();
  await expect(card).toBeVisible();
  await expect(card).toContainText('« Sous-agents du moteur intégré » s’applique au redémarrage du moteur');
});
