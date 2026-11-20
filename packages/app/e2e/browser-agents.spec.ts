/**
 * One agent's tab per conversation (the browser redo, step 2), end to end: two conversations' agents each open and
 * read their own page while the person's tab stays where the person left it — the agent never works on a tab of
 * the person's (Paul, 2026-11-20) —; the agent's tab is in its conversation's pane, marked « Agent », and in no
 * other conversation's.
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const page = (title: string, text: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><main><p>${text}</p></main></body></html>`;

const PAGES = {
  '/mine': page('Ma page', 'la page de la personne'),
  '/a': page('Page A', 'contenu de A'),
  '/b': page('Page B', 'contenu de B'),
};

const Q = '<|"|>';
let pagesUrl = '';

/** Asked to look at page A or B, the model opens it, reads it, then says which it read. */
function model(prompts: string[]) {
  return (prompt: string): string => {
    prompts.push(prompt);
    const turn = prompt.slice(prompt.lastIndexOf('<|turn>user'));
    const which = /page ([AB])/.exec(turn)?.[1];
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
async function lookAt(ui: Page, which: 'A' | 'B'): Promise<void> {
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
