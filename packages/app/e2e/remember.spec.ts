/**
 * « Toujours autoriser » end to end (audit 2026-11-21, D3), as the market does
 * it: the card offers « Pour cette conversation » and « Toujours dans ce
 * projet » for the exact command it shows, said under its buttons; remembered
 * for a conversation, the same command passes there and is asked again in
 * another; remembered always, it is listed on the project's page, where
 * « Retirer » takes it back. A shell is asked every time, and says so. On a
 * page (a discussion, Paul's decision of 2026-11-20): « Toujours pour ce
 * site », listed in « Réglages · Permissions »; a password typed is asked
 * every time whatever was remembered.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const run = (program: string, args: string[]) =>
  `<|tool_call>call:run_command{program:${Q}${program}${Q},args:[${args.map((arg) => `${Q}${arg}${Q}`).join(',')}]}<tool_call|>`;

/** Asked to « teste », the model runs `node --version`; asked to « liste », a shell; « Fait. » once it read a result. */
function model(prompt: string): string {
  const user = prompt.lastIndexOf('<|turn>user');
  if (prompt.lastIndexOf('<|tool_response>') > user) return 'Fait.';
  const asked = prompt.slice(user);
  if (asked.includes('teste')) return run('node', ['--version']);
  if (asked.includes('liste')) return run('powershell', ['-Command', 'Get-ChildItem']);
  return 'ok';
}

const card = (page: Page) => page.getByRole('region', { name: 'Demande d’accord' });

async function answered(page: Page, text: string): Promise<void> {
  const ui = chat(page);
  const before = await ui.replies.count();
  await ui.send(text);
  await expect(ui.replies).toHaveCount(before + 1, { timeout: 15_000 });
}

async function choosePlume(page: Page): Promise<void> {
  await page.locator('aparte-approval-mode').getByRole('combobox').click();
  await page.getByRole('option', { name: 'Plume' }).click();
}

test('« Pour cette conversation »: the exact command passes there again, and is asked in another conversation', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: model } });
  await choosePlume(page);
  await chat(page).send('Lance, teste');
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await expect(card(page)).toContainText('Retenu : la commande exacte node --version');
  await expect(card(page).getByRole('button', { name: 'Toujours dans ce projet' })).toBeVisible();
  await card(page).getByRole('button', { name: 'Pour cette conversation' }).click();
  await expect(chat(page).replyText).toHaveText('Fait.', { timeout: 15_000 });

  await answered(page, 'Lance, teste encore');
  await expect(chat(page).replyText).toHaveText('Fait.', { timeout: 15_000 });
  await expect(card(page)).toHaveCount(0);

  // Listed in « Réglages de la conversation… », where « Retirer » takes it back (review of round 6).
  await page.getByRole('button', { name: 'Plus d’actions' }).click();
  await page.getByRole('menuitem', { name: 'Réglages de la conversation…' }).click();
  const settings = page.getByRole('dialog', { name: 'Réglages de la conversation' });
  const own = settings.getByRole('list', { name: 'Autorisé sans demander' });
  await expect(own).toContainText('Lancer node --version');
  await own.getByRole('button', { name: 'Retirer : Lancer node --version' }).click();
  await expect(settings.getByText('Rien n’est retenu.')).toBeVisible();
  await settings.getByRole('button', { name: 'Annuler' }).click();
  await chat(page).send('Lance, teste toujours');
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await card(page).getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect(chat(page).replyText).toHaveText('Fait.', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Nouvelle conversation', exact: true }).click();
  await choosePlume(page);
  await chat(page).send('Lance, teste');
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await expect(card(page)).toContainText('node --version');
});

test('« Toujours dans ce projet »: listed on the project’s page, saying what it lets pass; « Retirer » asks it again', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: model } });
  await choosePlume(page);
  await chat(page).send('Lance, teste');
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await card(page).getByRole('button', { name: 'Toujours dans ce projet' }).click();
  await expect(chat(page).replyText).toHaveText('Fait.', { timeout: 15_000 });

  // Another conversation of the project: it passes without asking.
  await page.getByRole('button', { name: 'Nouvelle conversation', exact: true }).click();
  await choosePlume(page);
  await answered(page, 'Lance, teste');
  await expect(chat(page).replyText).toHaveText('Fait.', { timeout: 15_000 });
  await expect(card(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: 'Permissions' }).click();
  // The app's own list says nothing of a project's rule.
  await expect(page.getByRole('region', { name: 'Autorisé sans demander' })).toContainText('Rien n’est retenu.');
  await page.getByRole('button', { name: /^Ouvrir / }).first().click();
  const rules = page.getByRole('list', { name: 'Autorisé sans demander' });
  await expect(rules).toContainText('Lancer node --version');
  await rules.getByRole('button', { name: 'Retirer : Lancer node --version' }).click();
  await expect(page.getByText('Rien n’est retenu.')).toBeVisible();

  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: 'Conversations' }).click();
  await page.getByRole('button', { name: 'Nouvelle conversation', exact: true }).click();
  await choosePlume(page);
  await chat(page).send('Lance, teste');
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
});

test('a shell is asked every time: the card says why, and offers nothing to remember', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: model } });
  await choosePlume(page);
  await chat(page).send('Lance, liste');
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await expect(card(page)).toContainText('Toujours demandé : un shell n’est jamais retenu.');
  await expect(card(page).getByRole('button', { name: 'Pour cette conversation' })).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: /^Toujours/ })).toHaveCount(0);
});

const FORM =
  '<!doctype html><html><head><meta charset="utf-8"><title>Connexion</title></head><body><main>' +
  '<button id="go" type="button" onclick="document.title = \'Cliqué\'">Aller</button>' +
  '<form action="/sent"><input id="password" type="password" autocomplete="current-password"><button id="send" type="submit">Envoyer</button></form>' +
  '</main></body></html>';

let pagesUrl = '';

/** In a discussion: open the page, click its button, type a password — its refusal read, asked again with confirm. */
function browsing(prompts: string[]) {
  return (prompt: string): string => {
    prompts.push(prompt);
    const turn = prompt.slice(prompt.lastIndexOf('<|turn>user'));
    const results = turn.split('<|tool_response>').length - 1;
    if (turn.includes('Ouvre')) return results === 0 ? `<|tool_call>call:browser_open{url:${Q}${pagesUrl}/form${Q}}<tool_call|>` : 'Ouvert.';
    if (turn.includes('Clique')) return results === 0 ? `<|tool_call>call:browser_act{action:${Q}click${Q},selector:${Q}#go${Q}}<tool_call|>` : 'Cliqué.';
    if (turn.includes('passe')) {
      if (results === 0) return `<|tool_call>call:browser_act{action:${Q}type${Q},selector:${Q}#password${Q},text:${Q}hunter2${Q}}<tool_call|>`;
      if (results === 1) return `<|tool_call>call:browser_act{action:${Q}type${Q},selector:${Q}#password${Q},text:${Q}hunter2${Q},confirm:true}<tool_call|>`;
      return 'Saisi.';
    }
    return 'ok';
  };
}

test('on a page in a discussion: « Toujours pour ce site », listed in the settings; a password is asked every time (Paul, 2026-11-20)', async ({ launch }) => {
  const prompts: string[] = [];
  const launched = await launch({ project: false, engine: { responder: (prompt) => browsing(prompts)(prompt), nCtx: 16_384 }, pages: { '/form': FORM } });
  pagesUrl = launched.pages!.url;
  const site = new URL(pagesUrl).origin;
  const { page } = launched;

  await chat(page).send('Ouvre la page');
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await expect(card(page)).toContainText(`Retenu : le site ${site}`);
  await card(page).getByRole('button', { name: 'Toujours pour ce site' }).click();
  await expect(chat(page).replyText).toHaveText('Ouvert.', { timeout: 20_000 });

  await chat(page).send('Clique sur Aller');
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await expect(card(page)).toContainText(`Retenu : le site ${site}`);
  await card(page).getByRole('button', { name: 'Toujours pour ce site' }).click();
  await expect(chat(page).replyText).toHaveText('Cliqué.', { timeout: 20_000 });

  // The site remembered: a click passes without asking.
  await answered(page, 'Clique encore');
  await expect(chat(page).replyText).toHaveText('Cliqué.', { timeout: 20_000 });
  await expect(card(page)).toHaveCount(0);

  // A password, on that very site: refused unconfirmed, then asked — with nothing to remember.
  await chat(page).send('Tape le mot de passe');
  await expect(card(page)).toBeVisible({ timeout: 20_000 });
  await expect(card(page)).toContainText('Toujours demandé : saisir un mot de passe ou une carte, envoyer un formulaire, choisir un fichier à téléverser.');
  await expect(card(page).getByRole('button', { name: /^Toujours/ })).toHaveCount(0);
  expect(prompts.at(-1)).toContain('types into a password field');
  await card(page).getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect(chat(page).replyText).toHaveText('Saisi.', { timeout: 20_000 });
  expect(prompts.at(-1)).toContain('Done: typed.');

  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: 'Permissions' }).click();
  const rules = page.getByRole('list', { name: 'Autorisé sans demander' });
  await expect(rules).toContainText(`Ouvrir les pages de ${site}`);
  await expect(rules).toContainText(`Agir sur les pages de ${site}`);
});
