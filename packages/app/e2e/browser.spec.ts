/**
 * The built-in browser (task 10.1), end to end: its pane — tabs, the address, the screen size — shows a page of
 * this machine in a native view placed over the pane, taken off when a page goes over the conversation; a page
 * never reaches the app; the agent opens a page (asked: it reaches the network) and reads it (not asked).
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  // Nothing of the pane runs past its edge (a name shown on hover included): no sideways scrollbar.
  expect(await page.evaluate(() => [...document.querySelectorAll('.bonaparte-pane__body')].map((body) => body.scrollWidth - body.clientWidth))).toEqual([0]);
  const desktop = (await placement(app))!.bounds.width;
  expect(desktop).toBeGreaterThan(360);

  await page.getByRole('group', { name: 'Taille d’écran' }).getByRole('button', { name: 'Téléphone' }).click();
  await expect.poll(async () => (await placement(app))?.bounds.width).toBe(360);

  // A page over the conversation takes it off: a native view would cover it.
  await page.keyboard.press('Control+j');
  await expect.poll(() => placement(app)).toBeNull();
});

test('an address typed without its scheme opens; « Page précédente » goes back, « Recharger » reloads, Ctrl T opens a tab (review of phase 10)', async ({ launch }) => {
  const { page, pages } = await launch({ engine: { responder: () => 'ok' }, pages: { '/rapport': RAPPORT, '/escape': '<!doctype html><title>Autre page</title><p>autre</p>' } });
  await openPane(page);
  const address = page.getByRole('textbox', { name: 'Adresse' });
  // As a person types it: no « http:// ».
  await address.fill(`${pages!.url.replace(/^http:\/\//, '')}/rapport`);
  await address.press('Enter');
  await expect(page.getByRole('tab', { name: /Récap hebdo/ })).toBeVisible({ timeout: 15_000 });
  await address.fill(`${pages!.url}/escape`);
  await address.press('Enter');
  await expect(page.getByRole('tab', { name: /Autre page/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Page précédente', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Récap hebdo/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Recharger', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Récap hebdo/ })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Control+t');
  await expect(page.getByRole('tab')).toHaveCount(2);
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
  // The pane open, the person sees the agent read: « L'agent lit la page ».
  await openPane(page);
  await ui.send('Regarde le récap');
  const card = page.getByRole('region', { name: 'Demande d’accord' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText(`${pagesUrl}/rapport`);
  await card.getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect(page.getByRole('img', { name: 'L’agent peut lire cette page' })).toContainText('L’agent lit la page', { timeout: 20_000 });
  await expect(ui.replyText).toHaveText('Lu.', { timeout: 20_000 });
  const read = prompts.findLast((prompt) => prompt.includes('Total 7 h 15')) ?? '';
  expect(read).toContain('Récap hebdo');
  expect(read).toContain('[error] TypeError: minutes');
});

let pagesUrl = '';

test('the agent opens a page it wrote — a file of the project — and reads it, asked nothing: a file is read (Paul, 2026-11-20)', async ({ launch }) => {
  const folder = await mkdtemp(join(tmpdir(), 'bp-snake-'));
  // A file of the disk outside the project: its page may not load it.
  const outside = await mkdtemp(join(tmpdir(), 'bp-outside-'));
  await writeFile(join(outside, 'leak.js'), 'document.querySelector("p").textContent += " — fuite";');
  await mkdir(join(folder, 'bac'));
  await writeFile(
    join(folder, 'bac', 'snake3.html'),
    `<!doctype html><meta charset="utf-8"><title>Snake</title><p>Score : 0</p><script src="snake.js"></script><script src="${pathToFileURL(join(outside, 'leak.js')).href}"></script>`,
  );
  await writeFile(join(folder, 'bac', 'snake.js'), 'document.querySelector("p").textContent += " — prêt";');
  const prompts: string[] = [];
  try {
    const { page } = await launch({
      engine: {
        responder: (prompt) => {
          prompts.push(prompt);
          const turn = prompt.slice(prompt.lastIndexOf('<|turn>user'));
          const results = turn.split('<|tool_response>').length - 1;
          if (!turn.includes('serpent')) return 'ok';
          if (results === 0) return `<|tool_call>call:browser_open_file{path:${Q}bac/snake3.html${Q}}<tool_call|>`;
          if (results === 1) return '<|tool_call>call:browser_read{}<tool_call|>';
          return 'Lu.';
        },
        nCtx: 16_384,
      },
      env: { BONAPARTE_E2E_PICK_FOLDER: folder },
    });
    await page.getByRole('button', { name: 'Nouveau projet' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouveau projet' });
    await dialog.getByRole('button', { name: 'Choisir un dossier…' }).click();
    await dialog.getByRole('button', { name: 'Créer le projet' }).click();
    await expect(dialog).toBeHidden();
    await chat(page).send('Montre le serpent');
    await expect(chat(page).replyText).toHaveText('Lu.', { timeout: 20_000 });
    await expect(page.getByRole('region', { name: 'Demande d’accord' })).toHaveCount(0);
    // Its page ran, its script loaded from its folder.
    const read = prompts.findLast((prompt) => prompt.includes('Score : 0')) ?? '';
    expect(read).toContain('Snake');
    expect(read).toContain('prêt');
    expect(read).not.toContain('fuite');
    // In Répétition the network is asked: the page of a file stays off it, and the model is told (review of 2026-11-20).
    expect(read).toContain('kept off the network');
  } finally {
    await rm(folder, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('a discussion reaches no file: the address of one, given to browser_open, opens nothing (review of 2026-11-20)', async ({ launch }) => {
  const folder = await mkdtemp(join(tmpdir(), 'bp-home-page-'));
  await writeFile(join(folder, 'notes.html'), '<!doctype html><meta charset="utf-8"><title>Notes</title><p>secret du dossier</p>');
  const url = pathToFileURL(join(folder, 'notes.html')).href;
  const prompts: string[] = [];
  try {
    const { page } = await launch({
      engine: {
        responder: (prompt) => {
          prompts.push(prompt);
          const turn = prompt.slice(prompt.lastIndexOf('<|turn>user'));
          if (!turn.includes('notes')) return 'ok';
          return turn.includes('<|tool_response>') ? 'Fini.' : `<|tool_call>call:browser_open{url:${Q}${url}${Q}}<tool_call|>`;
        },
        nCtx: 16_384,
      },
    });
    await expect(chat(page).editor).toBeVisible();
    await page.getByRole('navigation', { name: 'Projets et conversations', exact: true }).getByRole('button', { name: 'Nouvelle discussion' }).click();
    await chat(page).send('Ouvre mes notes');
    // browser_open is the network: asked in a discussion (Lecture) while « ask before the network » is on.
    const card = page.getByRole('region', { name: 'Demande d’accord' });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: 'Autoriser', exact: true }).click();
    await expect(chat(page).replyText).toHaveText('Fini.', { timeout: 20_000 });
    const answered = prompts.at(-1) ?? '';
    expect(answered).toContain('A discussion reaches no file');
    expect(answered).not.toContain('secret du dossier');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
