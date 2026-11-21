/**
 * The web search (task 10.4), end to end: the model calls web_search; the call is asked — network asks in every
 * mode while « Demander avant chaque accès au réseau » is ticked — and nothing is searched before « Autoriser »;
 * the hidden page reads the engine (a local one shaped as DuckDuckGo's page), and the model reads the results.
 * A discussion has it among its tools.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const SEARCH = `<|tool_call>call:web_search{query:${Q}kv cache llama.cpp${Q}}<tool_call|>`;
const RESULTS = [
  { title: 'KV cache in llama.cpp', href: '//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fkv', snippet: 'What the slot keeps.' },
  { title: 'Ad', href: '', snippet: 'an ad without its link' },
];

/** The model searches when asked to; it answers « Trouvé. » once it has read the results. */
function model(prompts: string[]) {
  return (prompt: string): string => {
    prompts.push(prompt);
    const user = prompt.lastIndexOf('<|turn>user');
    if (prompt.lastIndexOf('<|tool_response>') > user) return 'Trouvé.';
    return prompt.slice(user).includes('cherche') ? SEARCH : 'ok';
  };
}

const card = (page: Page) => page.getByRole('region', { name: 'Demande d’accord' });

test('web_search is asked before anything goes out; approved, the hidden page reads the engine and the model its results', async ({ launch }) => {
  const prompts: string[] = [];
  const { page, search } = await launch({ engine: { responder: model(prompts) }, search: { results: RESULTS } });
  const ui = chat(page);
  await ui.send('Que cherche-t-on sur le cache KV ?');

  const request = card(page);
  await expect(request).toBeVisible({ timeout: 15_000 });
  await expect(request).toContainText('web_search');
  expect(search!.queries).toEqual([]);

  await request.getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect(ui.replyText).toHaveText('Trouvé.', { timeout: 20_000 });
  expect(search!.queries).toEqual(['kv cache llama.cpp']);
  const read = prompts.findLast((prompt) => prompt.includes('<|tool_response>')) ?? '';
  expect(read).toContain('1. KV cache in llama.cpp — https://example.com/kv');
  expect(read).not.toContain('an ad without its link');
});

test('a discussion has web_search among its tools, and still no file tool (task 9.7)', async ({ launch }) => {
  const prompts: string[] = [];
  const { page } = await launch({ project: false, engine: { responder: model(prompts) } });
  const ui = chat(page);
  await ui.send('Bonjour');
  await expect(ui.replyText).toHaveText('ok', { timeout: 15_000 });
  expect(prompts.at(-1)).toContain('web_search');
  expect(prompts.at(-1)).not.toMatch(/declaration:(read_file|edit_file|write_file|run_command)[{]/);
});
