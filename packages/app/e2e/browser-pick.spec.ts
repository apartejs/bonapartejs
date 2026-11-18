/**
 * The person's tools on a page (task 10.2, board « Le navigateur et ses outils »), end to end: « Sélectionner un
 * élément » shows the element clicked — its text, size, font, colour — and « Joindre à la conversation » puts it
 * in the composer as a pill whose words reach the model; « Commenter la page » pins numbered comments that leave
 * together, in one message; the two tools exclude each other; the console counts its errors and warnings, and
 * « Joindre les erreurs à la conversation » attaches them.
 *
 * The click in the page is a click of the page itself (`element.click()` through the agent's own action):
 * Playwright drives the window, not the native view the page lives in.
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const RAPPORT = [
  '<!doctype html><html><head><title>Récap hebdo</title></head><body>',
  '<table><tbody><tr><td>Lundi</td><td class="hours" style="font-weight: 700">1,3 h</td></tr></tbody></table>',
  '<button class="export">Exporter</button>',
  '<script>console.error("TypeError: minutes"); console.warn("Image sans alt")</script>',
  '</body></html>',
].join('');

const clickInPage = (app: ElectronApplication, selector: string) =>
  app.evaluate(
    (_electron, target) =>
      (globalThis as unknown as { __bonaparteBrowser: { agentAct(action: { kind: 'click'; selector: string }): Promise<unknown> } }).__bonaparteBrowser.agentAct({
        kind: 'click',
        selector: target,
      }),
    selector,
  );

async function openRapport(page: Page, url: string): Promise<void> {
  await expect(chat(page).editor).toBeVisible();
  await page.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Navigateur' }).click();
  const address = page.getByRole('textbox', { name: 'Adresse' });
  await address.fill(`${url}/rapport`);
  await address.press('Enter');
  await expect(page.getByRole('tab', { name: /Récap hebdo/ })).toBeVisible({ timeout: 15_000 });
}

test('« Sélectionner un élément » shows the element clicked; « Joindre à la conversation » sends it as a pill', async ({ launch }) => {
  const prompts: string[] = [];
  const { app, page, pages } = await launch({
    engine: { responder: () => 'ok', onCompletion: (body) => prompts.push(String(body['prompt'])) },
    pages: { '/rapport': RAPPORT },
  });
  await openRapport(page, pages!.url);
  const tools = page.getByRole('group', { name: 'Outils de la page' });
  const select = tools.getByRole('button', { name: 'Sélectionner un élément' });
  await select.click();
  await expect(select).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Survole la page et clique un élément/)).toBeVisible();

  // The picker is armed once the page has it: click until the card says what was clicked.
  const card = page.getByRole('region', { name: 'td.hours' });
  await expect(async () => {
    await clickInPage(app, 'td.hours');
    await expect(card).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(card).toContainText('1,3 h');
  await expect(card).toContainText(/Taille : \d+ × \d+/);
  await expect(card).toContainText(/Police : \d+ px, gras/);
  await expect(card).toContainText(/Couleur : rgb/);

  await card.getByRole('button', { name: 'Joindre à la conversation' }).click();
  await expect(card).toHaveCount(0);
  await expect(select).toHaveAttribute('aria-pressed', 'false');
  // A pill in the composer, its label the selector; the message says it in full.
  await expect(chat(page).editor.locator('[data-kind="page-element"]')).toContainText('td.hours');
  await page.keyboard.type(' pourquoi 1,3 ?');
  await chat(page).sendButton.click();
  await expect.poll(() => prompts.findLast((prompt) => prompt.includes('pourquoi 1,3')) ?? '', { timeout: 15_000 }).toContain('`td.hours`');
  expect(prompts.findLast((prompt) => prompt.includes('pourquoi 1,3'))).toContain('texte « 1,3 h »');
});

test('« Commenter la page » pins numbered comments that leave together, in one message; the two tools exclude each other', async ({ launch }) => {
  const prompts: string[] = [];
  const { app, page, pages } = await launch({
    engine: { responder: () => 'ok', onCompletion: (body) => prompts.push(String(body['prompt'])) },
    pages: { '/rapport': RAPPORT },
  });
  await openRapport(page, pages!.url);
  const tools = page.getByRole('group', { name: 'Outils de la page' });
  const select = tools.getByRole('button', { name: 'Sélectionner un élément' });
  const comment = tools.getByRole('button', { name: 'Commenter la page' });
  await select.click();
  await comment.click();
  await expect(comment).toHaveAttribute('aria-pressed', 'true');
  await expect(select).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText(/Clique sur la page pour laisser un commentaire/)).toBeVisible();

  const first = page.getByRole('textbox', { name: 'Commentaire 1' });
  await expect(async () => {
    await clickInPage(app, 'button.export');
    await expect(first).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await first.fill('Sur téléphone, le bouton déborde.');
  const second = page.getByRole('textbox', { name: 'Commentaire 2' });
  await expect(async () => {
    await clickInPage(app, 'td.hours');
    await expect(second).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await second.fill('Ça devrait afficher 1,5 h.');
  await expect(page.getByText('2 commentaires')).toBeVisible();

  const turns = prompts.length;
  await page.getByRole('button', { name: 'Envoyer à l’agent' }).click();
  await expect.poll(() => prompts.findLast((prompt) => prompt.includes('Mes commentaires sur')) ?? '', { timeout: 15_000 }).toContain(
    '1. `button.export` — Sur téléphone, le bouton déborde.',
  );
  const sent = prompts.findLast((prompt) => prompt.includes('Mes commentaires sur'))!;
  expect(sent).toContain('2. `td.hours` — Ça devrait afficher 1,5 h.');
  // One message, one turn: the comments left together.
  expect(prompts.slice(turns).filter((prompt) => prompt.includes('Mes commentaires sur'))).toHaveLength(1);
  await expect(page.getByRole('textbox', { name: 'Commentaire 1' })).toHaveCount(0);
});

test('the console counts its errors and warnings; « Joindre les erreurs à la conversation » attaches them', async ({ launch }) => {
  const { page, pages } = await launch({ engine: { responder: () => 'ok' }, pages: { '/rapport': RAPPORT } });
  await openRapport(page, pages!.url);
  const console = page.getByRole('region', { name: 'Console' });
  const toggle = console.getByRole('button', { name: /Console/ });
  await expect(toggle).toContainText('1 erreur');
  // Electron's own advice to an unpackaged app is not the page's: one warning, the page's.
  await expect(toggle).toContainText('1 avertissement');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(console.locator('[data-console-level="error"]')).toContainText('TypeError: minutes');
  await expect(console.locator('[data-console-level="warning"]')).toContainText('Image sans alt');
  await console.getByRole('button', { name: 'Joindre les erreurs à la conversation' }).click();
  await expect(chat(page).editor.locator('[data-kind="console-errors"]')).toContainText('1 erreur');
});
