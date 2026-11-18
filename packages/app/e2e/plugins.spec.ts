/**
 * Réglages · Plugins and « Ajouter un plugin » (task 11.3, boards « Réglages · Plugins » and « Ajouter un
 * plugin »), end to end: the plugins added and the built-in ones, each with its scope and its effects, filtered
 * and counted; a switch per plugin — « Sous-agents » off takes run_subagent out of the next turn; a plugin read from
 * a folder before anything of it runs — its effects and what it will add shown — then added and switched on.
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';
import { conversationList } from './fixtures/conversations.js';

const BONJOUR: Record<string, string> = {
  'plugin.json': JSON.stringify({
    id: 'bonjour',
    name: 'Bonjour',
    version: '0.1.0',
    description: { en: 'Says hello.', fr: 'Dit bonjour.' },
    entry: { node: 'index.mjs' },
    effects: [{ effect: 'read', what: { en: 'nothing', fr: 'rien' } }],
    contributes: { tools: [{ name: 'greet', description: 'Say hello.', effect: 'read' }] },
  }),
  'index.mjs': "export default { activate(ctx) { ctx.registerToolHandler('greet', async () => ({ content: 'bonjour' })); } };\n",
};

async function openPage(page: Page): Promise<void> {
  await expect(chat(page).editor).toBeVisible();
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: /^Plugins/ }).click();
}

const row = (page: Page, name: string) => page.locator('.plugin-row').filter({ has: page.locator('.plugin-row__name', { hasText: name }) });

test('the plugins added and the built-in ones, with their scope and effects, filtered and counted; « Sous-agents » off leaves the next turn', async ({ launch }) => {
  const prompts: string[] = [];
  const { page } = await launch({ engine: { responder: () => 'Bien reçu.', onCompletion: (body) => prompts.push(String(body['prompt'])) }, plugins: { bonjour: BONJOUR } });
  await chat(page).send('Bonjour');
  await expect(chat(page).replies).toHaveCount(1, { timeout: 15_000 });
  await openPage(page);
  await expect(page.getByText(/Ce que l’app et l’agent savent faire en plus/)).toBeVisible();
  const added = page.getByRole('region', { name: 'Ajoutés' });
  await expect(added.locator('.plugin-row__name', { hasText: 'Bonjour' })).toBeVisible();
  await expect(row(page, 'Bonjour')).toContainText('Toute l’app');
  await expect(row(page, 'Bonjour')).toContainText('Lit');
  await expect(row(page, 'Bonjour')).toContainText('Depuis un dossier');
  const builtin = page.getByRole('region', { name: 'Intégrés' });
  for (const name of ['Terminal', 'Navigateur', 'Recherche web', 'Scripts du projet', 'Titres automatiques', 'Sous-agents']) {
    await expect(builtin.locator('.plugin-row__name', { hasText: name })).toBeVisible();
  }
  await expect(row(page, 'Titres automatiques')).toContainText('Interface seule');
  const show = page.getByRole('radiogroup', { name: 'Afficher' });
  await expect(show).toContainText('Coupés · 0');

  const subagents = row(page, 'Sous-agents').getByRole('switch', { name: 'Sous-agents' });
  await expect(subagents).toBeChecked();
  await subagents.click();
  await expect(subagents).not.toBeChecked();
  await expect(show).toContainText('Coupés · 1');
  await page.getByRole('searchbox', { name: 'Filtrer les plugins' }).fill('bonj');
  await expect(page.locator('.plugin-row')).toHaveCount(1);

  await page.getByRole('link', { name: 'Conversations' }).click();
  await chat(page).send('Encore');
  await expect(chat(page).replies).toHaveCount(2, { timeout: 15_000 });
  // The fake engine records a prompt once it has answered: waited for.
  await expect.poll(() => prompts.some((prompt) => prompt.includes('Encore'))).toBe(true);
  const last = prompts.find((prompt) => prompt.includes('Encore'))!;
  // What the turn added after the last answer: the note of the inventory, then the message.
  expect(last.slice(last.lastIndexOf('Bien reçu.'))).toMatch(/Tools removed \(do not call them\): run_subagent/);
});

test('« Ajouter un plugin »: read from a folder before anything of it runs, its effects shown, then added and switched on', async ({ launch }) => {
  const folder = await mkdtemp(join(tmpdir(), 'bp-e2e-plugin-'));
  for (const [name, text] of Object.entries(BONJOUR)) await writeFile(join(folder, name), text);
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await openPage(page);
  await page.getByRole('button', { name: 'Ajouter…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ajouter un plugin' });
  await expect(dialog.getByRole('radio', { name: 'Un dossier' })).toBeChecked();
  await dialog.getByRole('textbox', { name: 'Dossier du plugin' }).fill(folder);
  await dialog.getByRole('button', { name: 'Lire le plugin' }).click();
  await expect(dialog).toContainText('Manifeste lu · auteur non vérifié', { timeout: 15_000 });
  await expect(dialog).toContainText('Avant de l’activer, ce qu’il pourra faire');
  await expect(dialog).toContainText('Lit');
  await expect(dialog).toContainText('Il ajoutera un outil greet pour l’agent.');
  await expect(dialog).toContainText('Un plugin est du code qui tourne sur ta machine');
  await dialog.getByRole('button', { name: 'Ajouter et activer' }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, 'Bonjour').getByRole('switch', { name: 'Bonjour' })).toBeChecked({ timeout: 15_000 });
  await expect(row(page, 'Bonjour')).toContainText(folder);
});

test('« Titres automatiques » off: a new conversation keeps its untitled name', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await openPage(page);
  await row(page, 'Titres automatiques').getByRole('switch', { name: 'Titres automatiques' }).click();
  await expect(row(page, 'Titres automatiques').getByRole('switch', { name: 'Titres automatiques' })).not.toBeChecked();
  await page.getByRole('link', { name: 'Conversations' }).click();
  await chat(page).send('Ma question sur les heures');
  await expect(chat(page).replies).toHaveCount(1, { timeout: 15_000 });
  await expect(conversationList(page).row('Nouvelle conversation')).toBeVisible();
  await expect(conversationList(page).row('Ma question sur les heures')).toHaveCount(0);
});

test('a project’s page: the MCP servers and plugins it uses; a plugin switched off for it stays on for the app', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' }, mcp: { fake: { command: process.execPath, args: ['--version'] } } });
  await expect(chat(page).editor).toBeVisible();
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: 'Permissions' }).click();
  await page.getByRole('button', { name: /^Ouvrir maison/ }).click();
  await expect(page.getByText(/Ce projet utilise 1 serveur MCP et \d+ plugins/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Serveurs MCP' })).toContainText('fake');
  const plugins = page.getByRole('list', { name: 'Plugins' });
  await plugins.getByRole('switch', { name: 'Terminal' }).click();
  await expect(plugins.getByRole('switch', { name: 'Terminal' })).not.toBeChecked();
  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: /^Plugins/ }).click();
  await expect(row(page, 'Terminal').getByRole('switch', { name: 'Terminal' })).toBeChecked();
});

test('a plugin switched off for the whole app is not offered on a project’s page — no switch there that would snap back', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await openPage(page);
  await row(page, 'Terminal').getByRole('switch', { name: 'Terminal' }).click();
  await expect(row(page, 'Terminal').getByRole('switch', { name: 'Terminal' })).not.toBeChecked();
  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: 'Permissions' }).click();
  await page.getByRole('button', { name: /^Ouvrir maison/ }).click();
  const plugins = page.getByRole('list', { name: 'Plugins' });
  await expect(plugins.getByRole('switch', { name: 'Navigateur' })).toBeVisible();
  await expect(plugins.getByRole('switch', { name: 'Terminal' })).toHaveCount(0);
});
