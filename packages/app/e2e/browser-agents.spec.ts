/**
 * One agent's tab per conversation (the browser redo, step 2), end to end: two conversations' agents each open and
 * read their own page while the person's tab stays where the person left it — the agent never works on a tab of
 * the person's (Paul, 2026-11-20) —; the agent's tab is in its conversation's pane, marked « Agent », and in no
 * other conversation's. The agent's session is never the person's: a cookie the person's page set is not the
 * agent's; a conversation deleted takes its agent's tab with it; the pane always has a tab of the person's (review
 * of step 2).
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';
import { conversationList } from './fixtures/conversations.js';

const page = (title: string, text: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><main><p>${text}</p></main></body></html>`;

const PAGES = {
  '/mine': page('Ma page', 'la page de la personne'),
  '/a': page('Page A', 'contenu de A'),
  '/b': page('Page B', 'contenu de B'),
  // The person's page sets a cookie, and says in its title that its session holds it.
  '/set-cookie':
    '<!doctype html><html><head><meta charset="utf-8"><title>Ma page</title></head><body><main><p>cookie posé</p></main>' +
    "<script>document.cookie = 'personne=SECRET-DE-LA-PERSONNE; path=/; max-age=3600'; document.title = document.cookie.includes('SECRET') ? 'Ma page avec cookie' : 'Ma page sans cookie';</script></body></html>",
  // The agent's page prints the cookies its session holds for the same address.
  '/c':
    '<!doctype html><html><head><meta charset="utf-8"><title>Page C</title></head><body><main><p id="said"></p></main>' +
    "<script>document.getElementById('said').textContent = 'cookies: [' + document.cookie + ']';</script></body></html>",
};

const Q = '<|"|>';
let pagesUrl = '';

/** Asked to look at page A or B, the model opens it, reads it, then says which it read. */
function model(prompts: string[]) {
  return (prompt: string): string => {
    prompts.push(prompt);
    const turn = prompt.slice(prompt.lastIndexOf('<|turn>user'));
    const which = /page ([ABC])/.exec(turn)?.[1];
    if (!which) return 'ok';
    const results = turn.split('<|tool_response>').length - 1;
    if (results === 0) return `<|tool_call>call:browser_open{url:${Q}${pagesUrl}/${which.toLowerCase()}${Q}}<tool_call|>`;
    if (results === 1) return '<|tool_call>call:browser_read{}<tool_call|>';
    return `Lu ${which}.`;
  };
}

/** The person's tabs, as the main process holds them: never the agent's. */
const personTabs = (app: ElectronApplication) =>
  app.evaluate(() =>
    (globalThis as unknown as { __bonaparteBrowser: { states(conversationId: string | null): { url: string; agent?: boolean }[] } }).__bonaparteBrowser
      .states(null)
      .filter((tab) => !tab.agent)
      .map((tab) => tab.url),
  );

async function openPane(ui: Page): Promise<void> {
  await expect(chat(ui).editor).toBeVisible();
  await ui.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Navigateur' }).click();
  await expect(ui.getByRole('tablist', { name: 'Onglets' })).toBeVisible();
}

/** The person asks to look at a page; the opening is the network, asked: allowed. */
async function lookAt(ui: Page, which: 'A' | 'B' | 'C'): Promise<void> {
  await chat(ui).send(`Regarde la page ${which}`);
  const card = ui.getByRole('region', { name: 'Demande d’accord' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect(chat(ui).replyText).toHaveText(`Lu ${which}.`, { timeout: 20_000 });
}

const nav = (ui: Page) => ui.getByRole('navigation', { name: 'Projets et conversations', exact: true });

test('two conversations’ agents each open and read their own page; the person’s tab stays where the person left it', async ({ launch }) => {
  const prompts: string[] = [];
  const launched = await launch({ engine: { responder: (prompt) => model(prompts)(prompt), nCtx: 16_384 }, pages: PAGES });
  pagesUrl = launched.pages!.url;
  const { app, page: ui } = launched;
  await openPane(ui);
  const address = ui.getByRole('textbox', { name: 'Adresse' });
  await address.fill(`${pagesUrl}/mine`);
  await address.press('Enter');
  await expect(ui.getByRole('tab', { name: /Ma page/ })).toBeVisible({ timeout: 15_000 });

  await lookAt(ui, 'A');
  const readA = prompts.findLast((prompt) => prompt.includes('<|tool_response>') && prompt.includes('contenu de A')) ?? '';
  expect(readA).toContain('Page A');
  expect(readA).not.toContain('la page de la personne');
  expect(await personTabs(app)).toEqual([`${pagesUrl}/mine`]);
  // The person's tab is still theirs, shown in the pane.
  await expect(ui.getByRole('tab', { name: /Ma page/ })).toBeVisible();

  await ui.getByRole('button', { name: 'Nouvelle conversation', exact: true }).first().click();
  await lookAt(ui, 'B');
  const readB = prompts.findLast((prompt) => prompt.includes('<|tool_response>') && prompt.includes('contenu de B')) ?? '';
  expect(readB).toContain('Page B');
  // Its own page, not the other conversation's, nor the person's.
  expect(readB).not.toContain('contenu de A');
  expect(readB).not.toContain('la page de la personne');
  expect(await personTabs(app)).toEqual([`${pagesUrl}/mine`]);
});

test('the agent’s tab shows as « Agent » in its conversation’s pane, and in no other conversation’s', async ({ launch }) => {
  const prompts: string[] = [];
  const launched = await launch({ engine: { responder: (prompt) => model(prompts)(prompt), nCtx: 16_384 }, pages: PAGES });
  pagesUrl = launched.pages!.url;
  const { page: ui } = launched;
  await lookAt(ui, 'A');
  // The pane opened by itself (step 1), on the agent's page, its tab marked.
  const agentTab = ui.getByRole('tab', { name: /Agent.*Page A/ });
  await expect(agentTab).toBeVisible({ timeout: 15_000 });
  await expect(agentTab).toHaveAttribute('aria-selected', 'true');

  // Another conversation's pane has no tab of that agent.
  await ui.getByRole('button', { name: 'Nouvelle conversation', exact: true }).first().click();
  await expect(chat(ui).editor).toBeVisible();
  if (!(await ui.getByRole('tablist', { name: 'Onglets' }).isVisible())) await openPane(ui);
  // A tab of the person's, fresh: the pane is never without one.
  await expect(ui.getByRole('tab', { name: /Nouvel onglet/ })).toBeVisible();
  await expect(ui.getByRole('tab', { name: /Agent/ })).toHaveCount(0);
  await expect(ui.getByRole('tab', { name: /Page A/ })).toHaveCount(0);

  // Back in its conversation, it is there again.
  await nav(ui).getByRole('button', { name: /^Regarde la page A/ }).first().click();
  await expect(ui.getByRole('tab', { name: /Agent.*Page A/ })).toBeVisible({ timeout: 15_000 });
});

test('a blank « Nouvel onglet » is the person’s: the agent’s page waits behind it, marked « Nouveau », and the address the person types goes to their tab (third review of step 2)', async ({ launch }) => {
  const prompts: string[] = [];
  const launched = await launch({ engine: { responder: (prompt) => model(prompts)(prompt), nCtx: 16_384 }, pages: PAGES });
  pagesUrl = launched.pages!.url;
  const { app, page: ui } = launched;
  await openPane(ui);
  const blank = ui.getByRole('tab', { name: /^Nouvel onglet$/ });
  await expect(blank).toHaveAttribute('aria-selected', 'true');

  await lookAt(ui, 'A');
  // The agent's tab is there, behind the person's blank one, marked.
  const agentTab = ui.getByRole('tab', { name: /Agent.*Page A/ });
  await expect(agentTab).toBeVisible({ timeout: 15_000 });
  await expect(blank).toHaveAttribute('aria-selected', 'true');
  await expect(agentTab).toContainText('Nouveau');

  // The person types an address: their own tab goes there, the agent's stays on its page.
  const address = ui.getByRole('textbox', { name: 'Adresse' });
  await address.fill(`${pagesUrl}/mine`);
  await address.press('Enter');
  await expect(ui.getByRole('tab', { name: /Ma page/ })).toBeVisible({ timeout: 15_000 });
  expect(await personTabs(app)).toEqual([`${pagesUrl}/mine`]);
  await expect(agentTab).toContainText('Page A');

  // Shown, the agent's page is seen: its mark goes.
  await agentTab.click();
  await expect(agentTab).toHaveAttribute('aria-selected', 'true');
  await expect(agentTab).not.toContainText('Nouveau');
});

/** A conversation's agent tab, as the main process holds it. */
const agentTabs = (app: ElectronApplication, conversationId: string) =>
  app.evaluate(
    (_electron, id) =>
      (globalThis as unknown as { __bonaparteBrowser: { states(conversationId: string | null): { tabId: string; agent?: boolean }[] } }).__bonaparteBrowser
        .states(id)
        .filter((tab) => tab.agent)
        .map((tab) => tab.tabId),
    conversationId,
  );

test('the agent’s session is never the person’s: a cookie the person’s page set is not the agent’s (review of step 2)', async ({ launch }) => {
  const prompts: string[] = [];
  const launched = await launch({ engine: { responder: (prompt) => model(prompts)(prompt), nCtx: 16_384 }, pages: PAGES });
  pagesUrl = launched.pages!.url;
  const { page: ui } = launched;
  await openPane(ui);
  const address = ui.getByRole('textbox', { name: 'Adresse' });
  await address.fill(`${pagesUrl}/set-cookie`);
  await address.press('Enter');
  // The person's session holds the cookie: their page says so.
  await expect(ui.getByRole('tab', { name: /Ma page avec cookie/ })).toBeVisible({ timeout: 15_000 });

  // The agent opens a page of the same address that prints its cookies: none of the person's.
  await lookAt(ui, 'C');
  const read = prompts.findLast((prompt) => prompt.includes('<|tool_response>') && prompt.includes('cookies: [')) ?? '';
  expect(read).toContain('cookies: []');
  expect(read).not.toContain('SECRET-DE-LA-PERSONNE');
});

test('a conversation deleted takes its agent’s tab with it (review of step 2)', async ({ launch }) => {
  const prompts: string[] = [];
  const launched = await launch({ engine: { responder: (prompt) => model(prompts)(prompt), nCtx: 16_384 }, pages: PAGES });
  pagesUrl = launched.pages!.url;
  const { app, page: ui } = launched;
  await lookAt(ui, 'A');
  const sidebar = conversationList(ui);
  const id = await sidebar.row('Regarde la page A').first().getAttribute('data-conv-id');
  expect(id).toBeTruthy();
  expect(await agentTabs(app, id!)).toEqual([`agent:${id}`]);

  await sidebar.openMenu('Regarde la page A');
  await ui.getByRole('menuitem', { name: 'Supprimer' }).click();
  await ui.getByRole('dialog', { name: /Supprimer « Regarde la page A »/ }).getByRole('button', { name: 'Supprimer' }).click();
  await expect(sidebar.row('Regarde la page A')).toHaveCount(0);
  await expect.poll(() => agentTabs(app, id!)).toEqual([]);
});

test('the pane always has a tab of the person’s: beside the agent’s, and again once the person closed their last one (review of step 2)', async ({ launch }) => {
  const prompts: string[] = [];
  const launched = await launch({ engine: { responder: (prompt) => model(prompts)(prompt), nCtx: 16_384 }, pages: PAGES });
  pagesUrl = launched.pages!.url;
  const { page: ui } = launched;
  await lookAt(ui, 'A');
  // The pane opened by itself on the agent's page; a tab of the person's beside it.
  await expect(ui.getByRole('tab', { name: /Agent.*Page A/ })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  const fresh = ui.getByRole('tab', { name: /^Nouvel onglet$/ });
  await expect(fresh).toHaveCount(1);
  // Closed, the person's last tab is replaced by a fresh one: the agent's is not theirs.
  await ui.getByRole('button', { name: 'Fermer Nouvel onglet' }).click();
  await expect(fresh).toHaveCount(1);
  await expect(ui.getByRole('tablist', { name: 'Onglets' }).getByRole('tab')).toHaveCount(2);
});
