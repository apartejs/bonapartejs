/**
 * The first launch (task 9.6, board « Premier lancement »): the built-in engine or a service the person
 * already has. The built-in engine says what it finds — llama.cpp, the card, the models — and recommends
 * models to download, their size said before the click; a service is tested, then connected, and the
 * conversation goes there. Nothing is loaded, downloaded nor sent before a click.
 */

import { expect, test } from './fixtures/app.js';
import { FAKE_QWEN_TEMPLATE } from '@aparte/bonaparte-core/testing';
import { chat } from './fixtures/chat.js';
import { loadFirstModel } from './fixtures/engine.js';

const MODELS = { 'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 } };

test('two engines, the built-in one first: what it finds, the context and its gauge, and nothing loaded', async ({ launch }) => {
  const { page } = await launch({ managed: { models: MODELS } });
  await expect(page.getByRole('heading', { name: 'Préparons le moteur' })).toBeVisible();
  const engines = page.getByRole('radiogroup', { name: 'Moteur' });
  await expect(engines.getByRole('radio', { name: /Moteur intégré/ })).toBeChecked();
  await expect(engines).toContainText('Recommandé');
  await expect(engines.getByRole('radio', { name: /Un service existant/ })).not.toBeChecked();

  await expect(page.locator('.first-run__gpu')).toContainText('24 Go de mémoire vidéo');
  await expect(page.getByText(/^Taille du contexte : \d+ k$/)).toBeVisible();
  // The gauge: the model, its context and the margin, out of the card's memory.
  await expect(page.getByRole('img', { name: /^[\d,]+ [GM]o sur 24 Go de mémoire vidéo$/ })).toBeVisible();
  await expect(page.locator('.first-run__legend')).toContainText('modèle');
  await expect(page.locator('.first-run__legend')).toContainText('mémoire du contexte');
  await expect(page.locator('.first-run__legend')).toContainText('marge');

  const state = await page.evaluate(() => {
    const preload = window as unknown as { bonaparte: { invoke(name: string, input: unknown): Promise<unknown> } };
    return preload.bonaparte.invoke('engine.state', undefined);
  });
  expect(state).toEqual({ mode: 'managed', status: 'stopped' });
});

test('a recommended model: its size said, downloaded on a click, then among the models found and chosen', async ({ launch }) => {
  const { page, hub } = await launch({
    managed: { models: {} },
    hub: { models: { 'gemma-petit': { family: 'gemma' } }, paceMs: 200 },
  });
  const row = page.locator('.recommended-row', { hasText: 'gemma-petit' });
  await expect(row).toBeVisible();
  await expect(page.locator('.first-run__recommended')).toContainText('Conseillés pour ta machine');
  // Nothing fetched before the click.
  expect(hub!.downloads).toBe(0);
  await row.getByRole('button', { name: /^Télécharger · [\d,]+ [KM]o$/ }).click();
  await expect(row.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('radio', { name: /gemma-petit/ })).toBeChecked({ timeout: 15_000 });
  expect(hub!.downloads).toBe(1);
  await expect(page.getByRole('button', { name: 'Démarrer' })).toBeEnabled();
});

test('a service: tested, connected, and the conversation goes there — nothing sent before « Se connecter »', async ({ launch }) => {
  const { page, service } = await launch({
    managed: { models: {} },
    service: { models: ['qwen3:8b'], responder: () => ({ text: 'Bonjour depuis Ollama.' }) },
    serviceAdded: false,
  });
  await page.getByRole('radiogroup', { name: 'Moteur' }).getByRole('radio', { name: /Un service existant/ }).click();
  await expect(page.getByRole('radiogroup', { name: 'Service' }).getByRole('radio', { name: 'Ollama' })).toBeChecked();
  await expect(page.locator('.first-run__without')).toContainText('Ce que tu n’auras pas sans le moteur intégré');

  const address = page.getByRole('textbox', { name: 'Adresse' });
  await address.fill('http://127.0.0.1:9/v1');
  await page.getByRole('button', { name: 'Tester la connexion' }).click();
  await expect(page.locator('.first-run__tested')).toContainText('Rien ne répond à cette adresse', { timeout: 10_000 });

  await address.fill(`${service!.url}/v1`);
  await page.getByRole('button', { name: 'Tester la connexion' }).click();
  await expect(page.locator('.first-run__tested')).toHaveText('Connecté · 1 modèle');
  expect(service!.requests).toHaveLength(0);

  await page.getByRole('button', { name: 'Se connecter' }).click();
  const ui = chat(page);
  await expect(ui.editor).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('combobox', { name: 'Modèle' })).toContainText('qwen3:8b');
  await ui.send('Bonjour');
  await expect(ui.replyText).toHaveText('Bonjour depuis Ollama.', { timeout: 15_000 });
  expect(service!.requests[0]!.model).toBe('qwen3:8b');
});

test('a service known and no model: the app opens on its conversations, and a message goes to the service', async ({ launch }) => {
  const { page, service } = await launch({
    managed: { models: {} },
    service: { models: ['qwen3:8b'], responder: () => ({ text: 'Toujours là.' }) },
  });
  const ui = chat(page);
  await expect(ui.editor).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Préparons le moteur' })).toHaveCount(0);
  await ui.send('Encore');
  await expect(ui.replyText).toHaveText('Toujours là.', { timeout: 15_000 });
  expect(service!.requests).toHaveLength(1);
});

test('another built-in model picked for a new conversation set on a service: it starts on the built-in engine (review of phase 9)', async ({ launch }) => {
  const { page, service } = await launch({
    managed: { models: { ...MODELS, 'qwen-e2e': { architecture: 'qwen3', chatTemplate: FAKE_QWEN_TEMPLATE, paddingBytes: 1024 * 1024 } } },
    service: { models: ['qwen3:8b'], responder: () => ({ text: 'Depuis Ollama.' }) },
  });
  await loadFirstModel(page);
  const ui = chat(page);
  await expect(ui.editor).toBeVisible({ timeout: 15_000 });
  const picker = page.getByRole('combobox', { name: 'Modèle' });
  // The service picked first, before any message…
  await picker.click();
  await page.getByText(/^Ollama$/i).click();
  await page.getByRole('option', { name: /qwen3:8b/ }).click();
  await expect(picker).toContainText('qwen3:8b');
  // …then another model of this machine: the conversation starts there.
  await picker.click();
  await page.getByText(/^Sur cette machine$/i).click();
  await page.getByRole('option', { name: /qwen-e2e/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Passer à qwen-e2e ?' });
  await dialog.getByRole('button', { name: 'Changer' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await ui.send('Bonjour');
  await expect(ui.replyText).toHaveText('ok', { timeout: 15_000 });
  expect(service!.requests).toHaveLength(0);
});

test('no engine can answer: said above the composer, the message held; the built-in engine prepared from there, and back (review of phase 9)', async ({ launch }) => {
  const { page, service } = await launch({
    managed: { models: MODELS },
    // A service known that offers no model now: not started, say.
    service: { models: [], responder: () => ({ text: 'jamais' }) },
  });
  const ui = chat(page);
  await expect(ui.editor).toBeVisible({ timeout: 15_000 });
  await ui.send('Bonjour');
  const card = page.getByRole('region', { name: 'Aucun moteur n’est prêt' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Ton message attend dans le champ');
  await expect(ui.userMessages).toHaveCount(0);
  expect(service!.requests).toHaveLength(0);

  await card.getByRole('button', { name: 'Préparer le moteur intégré…' }).click();
  await expect(page.getByRole('heading', { name: 'Préparons le moteur' })).toBeVisible();
  await page.getByRole('button', { name: 'Retour aux conversations' }).click();
  await expect(page.getByRole('heading', { name: 'Préparons le moteur' })).toHaveCount(0);
  await expect(card).toBeVisible();

  await card.getByRole('button', { name: 'Préparer le moteur intégré…' }).click();
  await page.getByRole('button', { name: 'Démarrer' }).click();
  await expect(page.getByRole('heading', { name: 'Préparons le moteur' })).toHaveCount(0, { timeout: 20_000 });
  await expect(card).toHaveCount(0, { timeout: 20_000 });
});

test('« Préparer le moteur intégré… » in the settings opens the first launch’s panel (review of phase 9)', async ({ launch }) => {
  const { page } = await launch({ managed: { models: MODELS } });
  await page.getByRole('button', { name: 'Démarrer' }).click();
  await expect(chat(page).editor).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await page.getByRole('navigation', { name: 'Réglages' }).getByRole('link', { name: 'Moteur et mémoire' }).click();
  await page.getByRole('button', { name: 'Préparer le moteur intégré…' }).click();
  await expect(page.getByRole('heading', { name: 'Préparons le moteur' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retour aux conversations' })).toBeVisible();
});
