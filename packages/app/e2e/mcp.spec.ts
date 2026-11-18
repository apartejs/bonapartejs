/**
 * The MCP servers (task 10.5), end to end: Réglages · Serveurs MCP lists them — stopped until something starts
 * them —, « Démarrer » connects one and its tools are split as the server says; a configuration pasted, a server
 * added; and a turn starts them, their tools reaching the model at the next turn.
 */

import type { Page } from '@playwright/test';
import { expect, FAKE_MCP_SERVER, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const FAKE = { command: process.execPath, args: [FAKE_MCP_SERVER] };

async function openPage(page: Page): Promise<void> {
  await expect(chat(page).editor).toBeVisible();
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: 'Serveurs MCP' }).click();
}

const row = (page: Page, name: string) => page.getByRole('list', { name: 'Serveurs MCP' }).getByRole('listitem').filter({ hasText: name });

test('a server is stopped until started; « Démarrer » connects it, its tools split as the server says', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' }, mcp: { fake: FAKE } });
  await openPage(page);
  const fake = row(page, 'fake');
  await expect(fake.getByRole('img', { name: 'Arrêté' })).toBeVisible();
  await expect(fake).toContainText('Arrêté : ses outils apparaîtront au démarrage');
  await expect(fake).toContainText('Toute l’app');
  await expect(page.getByRole('radiogroup', { name: 'Afficher' })).toContainText('Arrêtés · 1');

  await fake.getByRole('button', { name: 'Démarrer' }).click();
  await expect(fake.getByRole('img', { name: 'Connecté' })).toBeVisible({ timeout: 15_000 });
  await expect(fake.getByRole('button', { name: 'Redémarrer' })).toBeVisible();
  await expect(fake).toContainText(/\d+ outils/);
  await fake.getByRole('button', { name: 'Déplier fake' }).click();
  await expect(fake).toContainText('Lecture seule, d’après le serveur');
  await expect(fake).toContainText('Modifient le disque : demandés selon le mode');
  await expect(fake.locator('.mcp-server__chip', { hasText: 'echo' })).toBeVisible();
  await expect(fake.locator('.mcp-server__chip', { hasText: 'write_note' })).toBeVisible();
});

test('a configuration pasted, and a server added by its name and address: listed with their scope', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await openPage(page);
  await expect(page.getByText('Aucun serveur MCP.')).toBeVisible();

  await page.getByRole('button', { name: 'Coller une configuration' }).click();
  const paste = page.getByRole('dialog', { name: 'Coller une configuration' });
  await paste.getByRole('textbox').fill(JSON.stringify({ mcpServers: { pasted: FAKE } }));
  await paste.getByRole('button', { name: 'Ajouter' }).click();
  await expect(paste).toContainText('1 serveur ajouté.');
  await paste.getByRole('button', { name: 'Annuler' }).click();
  await expect(row(page, 'pasted')).toBeVisible();

  await page.getByRole('button', { name: 'Ajouter un serveur' }).click();
  const add = page.getByRole('dialog', { name: 'Ajouter un serveur' });
  await add.getByRole('textbox', { name: 'Nom' }).fill('web');
  await add.getByRole('textbox', { name: 'Adresse ou commande' }).fill('https://mcp.example.com/mcp');
  await add.getByRole('button', { name: 'Ajouter' }).click();
  await expect(add).toBeHidden();
  await expect(row(page, 'web')).toContainText('https://mcp.example.com/mcp');
  await expect(row(page, 'web')).toContainText('Toute l’app');
});

test('a turn starts the servers: their tools reach the model at the next turn, under their server’s name', async ({ launch }) => {
  const prompts: string[] = [];
  const { page } = await launch({
    engine: { responder: () => 'ok', onCompletion: (body) => prompts.push(String(body['prompt'])) },
    mcp: { fake: FAKE },
  });
  const ui = chat(page);
  await ui.send('Bonjour');
  await expect(ui.replies).toHaveCount(1, { timeout: 15_000 });
  await expect(ui.streamingReplies).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const preload = window as unknown as { bonaparte: { invoke(name: string, input: unknown): Promise<{ state: string }[]> } };
          return (await preload.bonaparte.invoke('mcp.overview', undefined))[0]?.state;
        }),
      { timeout: 15_000 },
    )
    .toBe('connected');
  await ui.send('Et maintenant ?');
  await expect(ui.replies).toHaveCount(2, { timeout: 15_000 });
  // The second turn's own prompt, kept by the fake engine once it has answered.
  await expect.poll(() => prompts.findLast((prompt) => prompt.includes('Et maintenant')) ?? '', { timeout: 15_000 }).toContain('mcp__fake__echo');
});
