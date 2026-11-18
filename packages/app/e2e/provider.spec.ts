/**
 * A conversation on a service (task 9.3): a model of a service that speaks OpenAI's API, picked in the
 * composer's model selector before the first message, takes the conversation there. What it loses is said
 * by what is not shown: no mark of memory, no gauge of a context the service does not tell.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';
import { conversationList } from './fixtures/conversations.js';

const MODELS = { 'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 } };
const picker = (page: Page) => page.getByRole('combobox', { name: 'Modèle' });

test('a model of a service picked before the first message: the conversation goes there, and shows no memory (task 9.3)', async ({ launch }) => {
  const { page, service } = await launch({
    managed: { models: MODELS },
    service: { models: ['qwen3:8b'], responder: () => ({ text: 'Bonjour depuis Ollama.' }) },
  });
  await page.getByRole('button', { name: 'Démarrer' }).click();
  const ui = chat(page);
  await expect(ui.composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });

  // Two providers: aparté groups the models by provider, each in its own list.
  await picker(page).click();
  await page.getByText(/^Ollama$/i).click();
  await page.getByRole('option', { name: /qwen3:8b/ }).click();
  await expect(picker(page)).toContainText('qwen3:8b');
  await ui.send('Bonjour');
  await expect(ui.replyText).toHaveText('Bonjour depuis Ollama.', { timeout: 15_000 });
  expect(service!.requests).toHaveLength(1);
  expect(service!.requests[0]!.model).toBe('qwen3:8b');

  // Nothing of the built-in engine: no memory to show, no gauge of a context the service does not tell.
  await expect(page.locator('aparte-context')).toHaveCount(0);
  const row = conversationList(page).row('Bonjour');
  await expect(row).toBeVisible();
  await expect(row.locator('.conv-memory[data-memory]')).toHaveCount(0);
});
