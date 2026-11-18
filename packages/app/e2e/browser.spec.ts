/**
 * The built-in browser (task 10.1), end to end: its pane — tabs, the address, the screen size — shows a page of
 * this machine in a native view placed over the pane, taken off when a page goes over the conversation; a page
 * never reaches the app; the agent opens a page (asked: it reaches the network) and reads it (not asked).
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const RAPPORT = '<!doctype html><html><head><title>Récap hebdo</title></head><body><main><h1>Récap de la semaine</h1><p>Total 7 h 15</p></main><script>console.error("TypeError: minutes")</script></body></html>';
const ESCAPE = '<!doctype html><html><head><title>Échappée</title></head><body><script>location.href = "bonaparte://app/";</script><p>reste ici</p></body></html>';

const placement = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __bonaparteBrowser: { placement(): { bounds: { width: number } } | null } }).__bonaparteBrowser.placement());

async function openPane(page: Page): Promise<void> {
  await expect(chat(page).editor).toBeVisible();
  await page.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Navigateur' }).click();
  await expect(page.getByRole('tablist', { name: 'Onglets' })).toBeVisible();
}

test('the pane opens a page of this machine in its tab, placed over it; « Téléphone » makes it 360 px wide', async ({ launch }) => {
  const { app, page, pages } = await launch({ engine: { responder: () => 'ok' }, pages: { '/rapport': RAPPORT } });
  await openPane(page);
  await expect(page.getByRole('tab', { name: /Nouvel onglet/ })).toBeVisible();
  const address = page.getByRole('textbox', { name: 'Adresse' });
  await address.fill(`${pages!.url}/rapport`);
  await address.press('Enter');
  await expect(page.getByRole('tab', { name: /Récap hebdo/ })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => placement(app)).not.toBeNull();
  const desktop = (await placement(app))!.bounds.width;
  expect(desktop).toBeGreaterThan(360);

  await page.getByRole('group', { name: 'Taille d’écran' }).getByRole('button', { name: 'Téléphone' }).click();
  await expect.poll(async () => (await placement(app))?.bounds.width).toBe(360);

  // A page over the conversation takes it off: a native view would cover it.
  await page.keyboard.press('Control+j');
  await expect.poll(() => placement(app)).toBeNull();
});

test('a new tab with « + », and closing the last tab opens a fresh one', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await openPane(page);
  await page.getByRole('button', { name: 'Nouvel onglet', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.getByRole('button', { name: 'Fermer Nouvel onglet' }).first().click();
  await page.getByRole('button', { name: 'Fermer Nouvel onglet' }).first().click();
  await expect(page.getByRole('tab')).toHaveCount(1);
});

test('a page cannot take its tab to the app: its navigation to bonaparte:// is refused', async ({ launch }) => {
  const launched = await launch({ engine: { responder: () => 'ok' }, pages: { '/escape': ESCAPE } });
  await openPane(launched.page);
  const address = launched.page.getByRole('textbox', { name: 'Adresse' });
  await address.fill(`${launched.pages!.url}/escape`);
  await address.press('Enter');
  await expect(launched.page.getByRole('tab', { name: /Échappée/ })).toBeVisible({ timeout: 15_000 });
  await launched.page.waitForTimeout(500);
  const urls = await launched.page.evaluate(async () => {
    const preload = window as unknown as { bonaparte: { invoke(name: string, input: unknown): Promise<{ tabs: { url: string }[] }> } };
    return (await preload.bonaparte.invoke('browser.tabs', undefined)).tabs.map((tab) => tab.url);
  });
  expect(urls.every((url) => url.startsWith('http://127.0.0.1'))).toBe(true);
});

const Q = '<|"|>';
/** The model opens the page, reads it, then answers. */
function model(url: string, prompts: string[]) {
  return (prompt: string): string => {
    prompts.push(prompt);
    const user = prompt.lastIndexOf('<|turn>user');
    const results = prompt.slice(user).split('<|tool_response>').length - 1;
    if (!prompt.slice(user).includes('récap')) return 'ok';
    if (results === 0) return `<|tool_call>call:browser_open{url:${Q}${url}${Q}}<tool_call|>`;
    if (results === 1) return '<|tool_call>call:browser_read{}<tool_call|>';
    return 'Lu.';
  };
}

test('the agent opens a page — asked, it reaches the network — then reads it, its text and its console, without asking', async ({ launch }) => {
  const prompts: string[] = [];
  // The inventory of tools weighs some 3,000 of the fake engine's tokens: a context of 4 k leaves no room for two rounds.
  const launched = await launch({ engine: { responder: (prompt) => model(`${pagesUrl}/rapport`, prompts)(prompt), nCtx: 16_384 }, pages: { '/rapport': RAPPORT } });
  pagesUrl = launched.pages!.url;
  const { page } = launched;
  const ui = chat(page);
  await ui.send('Regarde le récap');
  const card = page.getByRole('region', { name: 'Demande d’accord' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText(`${pagesUrl}/rapport`);
  await card.getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect(ui.replyText).toHaveText('Lu.', { timeout: 20_000 });
  const read = prompts.findLast((prompt) => prompt.includes('Total 7 h 15')) ?? '';
  expect(read).toContain('Récap hebdo');
  expect(read).toContain('[error] TypeError: minutes');
});

let pagesUrl = '';
