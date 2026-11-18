/**
 * Making a plugin in a conversation, end to end (task 11.4, board « Créer un plugin dans la conversation »): the
 * agent reads the guide, defines the plugin — compiled, never run — and its card says what it adds and what it may
 * do; « Essayer dans cette conversation » runs it there, its « / » command marked « À l'essai »; « Installer » makes
 * it a plugin added like the others, said to come from the conversation. The model is the fake engine's.
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';

/** A value in Gemma 4's call syntax: strings between its quotes, objects and lists as written. */
function gemma(value: unknown): string {
  if (typeof value === 'string') return `${Q}${value}${Q}`;
  if (Array.isArray(value)) return `[${value.map(gemma).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, inner]) => `${key}:${gemma(inner)}`).join(',')}}`;
  return String(value);
}

const MANIFEST = {
  id: 'changelog',
  name: 'changelog',
  version: '0.1.0',
  effects: [{ effect: 'execute', what: { en: 'run git log', fr: 'lancer git log' } }],
  contributes: { commands: [{ name: 'changelog', description: { en: 'Sum up the commits of the day', fr: 'Résumer les commits du jour' } }] },
};
const CODE = "export default { activate(ctx) { ctx.registerCommand('changelog', () => ({ send: 'Résume les commits du jour.' })); } };";

function agent(prompt: string): string {
  const user = prompt.lastIndexOf('<|turn>user');
  const results = prompt.slice(user).split('<|tool_response>').length - 1;
  if (!prompt.slice(user).includes('plugin')) return 'ok';
  if (results === 0) return '<|tool_call>call:harness_inspect{}<tool_call|>';
  if (results === 1) return `<|tool_call>call:extension_define{manifest:${gemma(MANIFEST)},code:${gemma(CODE)}}<tool_call|>`;
  return 'Voilà le plugin. Rien ne tourne tant que tu n’as pas dit oui.';
}

test('a plugin made in a conversation: its card, tried there with its « / » command on trial, then installed', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: agent }, settings: { defaultMode: 'plume' } });
  const ui = chat(page);
  await ui.send('Crée-moi un plugin : une commande /changelog qui résume les commits du jour.');
  await expect(ui.replyText).toHaveText(/Voilà le plugin/, { timeout: 30_000 });
  await expect(ui.toolLine('harness_inspect')).toContainText('Lu le guide des plugins');
  const card = page.locator('section.extension-card[data-extension="changelog"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Créé dans cette conversation · coupé tant que tu ne l’as pas installé');
  await expect(card).toContainText('la commande /changelog');
  await expect(card).toContainText('Exécute');
  await expect(card).toContainText('lancer git log');

  await card.getByRole('button', { name: 'Voir le code' }).click();
  await expect(card.locator('pre.extension-card__code')).toContainText("registerCommand('changelog'");

  await card.getByRole('button', { name: 'Essayer dans cette conversation' }).click();
  await expect(card).toContainText('À l’essai dans cette conversation');
  await ui.editor.click();
  // aparté names a group above its rows while nothing is searched (its rows carry no badge: apartejs/aparte#261).
  await page.keyboard.type('/');
  const option = page.getByRole('listbox').getByRole('option', { name: /changelog/ });
  await expect(option).toBeVisible();
  await expect(page.getByRole('listbox')).toContainText('À l’essai');
  await page.keyboard.press('Escape');

  await card.getByRole('button', { name: 'Installer' }).click();
  await expect(card).toContainText('Installé');
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: /^Plugins/ }).click();
  const row = page.locator('.plugin-row', { has: page.locator('.plugin-row__name', { hasText: 'changelog' }) });
  await expect(row).toContainText('Créé dans « ');
  await expect(row.getByRole('switch', { name: 'changelog' })).toBeChecked();
});
