/**
 * The plan mode, end to end (board « Le mode plan au travail »): in Lecture
 * the model presents its change as a plan — the steps, the files it
 * touches, what is left to settle — and writes nothing; « Lancer en Plume »
 * switches the conversation to Plume and gives the model the go-ahead, and
 * the model reads the new mode before it goes on.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const PLAN =
  `<|tool_call>call:update_plan{title:${Q}Exporter le récap${Q},` +
  `steps:[{title:${Q}Écrire toCsv${Q},status:${Q}pending${Q}},{title:${Q}Lancer la suite${Q},status:${Q}pending${Q}}],` +
  `files:[{path:${Q}src/csv.ts${Q},change:${Q}new${Q}},{path:${Q}notes.txt${Q},change:${Q}modified${Q}}],` +
  `questions:[${Q}Le séparateur : point-virgule ou virgule.${Q}]}<tool_call|>`;
const STARTED =
  `<|tool_call>call:update_plan{title:${Q}Exporter le récap${Q},` +
  `steps:[{title:${Q}Écrire toCsv${Q},status:${Q}in-progress${Q}},{title:${Q}Lancer la suite${Q},status:${Q}pending${Q}}]}<tool_call|>`;
const EDIT = `<|tool_call>call:edit_file{path:${Q}notes.txt${Q},old_string:${Q}first${Q},new_string:${Q}second${Q}}<tool_call|>`;

/**
 * In Lecture the model plans (« Voici le plan. » once it has the result). Told the plan is launched,
 * it sends the plan again with its first step in progress, then edits, then says « Fait. ».
 */
function model(prompt: string): string {
  const user = prompt.lastIndexOf('<|turn>user');
  const response = prompt.lastIndexOf('<|tool_response>');
  const launched = prompt.slice(prompt.lastIndexOf('[mode]')).includes('launched your plan');
  if (response > user) {
    const said = prompt.slice(response);
    if (said.includes('Edited')) return 'Fait.';
    return launched ? EDIT : 'Voici le plan.';
  }
  if (launched) return STARTED;
  if (prompt.lastIndexOf('[mode] Lecture') >= 0) return PLAN;
  return 'ok';
}

test('in Lecture a change is a plan, and nothing is written; « Lancer en Plume » switches and lets the model go on', async ({ launch }) => {
  const prompts: string[] = [];
  const { page, home } = await launch({ engine: { responder: model, onCompletion: (body) => prompts.push(String(body['prompt'])) } });
  await writeFile(join(home, 'notes.txt'), 'first\n');
  const ui = chat(page);
  await page.locator('aparte-approval-mode').getByRole('combobox').click();
  await page.getByRole('option', { name: 'Lecture' }).click();
  await ui.send('Ajoute un export CSV du récap');

  const plan = page.getByRole('region', { name: 'Plan' });
  await expect(plan.first()).toBeVisible({ timeout: 15_000 });
  await expect(plan).toContainText('Écrire toCsv');
  await expect(plan).toContainText('src/csv.ts');
  await expect(plan).toContainText('nouveau');
  await expect(plan).toContainText('modifié');
  await expect(plan).toContainText('À trancher en route');
  await expect(plan).toContainText('point-virgule ou virgule');
  expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('first\n');

  await plan.first().getByRole('button', { name: 'Lancer en Plume' }).click();
  await expect(page.locator('aparte-approval-mode').getByRole('combobox')).toContainText('Plume');
  await expect(ui.userMessages.last()).toContainText('Lance le plan.');
  await expect.poll(() => readFile(join(home, 'notes.txt'), 'utf8'), { timeout: 15_000 }).toBe('second\n');
  await expect(plan.first()).toContainText('Lancé en Plume');
  // The model sent the plan again, its first step in progress.
  await expect(plan.last().getByText('En cours')).toBeVisible();
  // The model read the new mode before it went on: told, appended, after the plan.
  const launched = prompts.find((prompt) => prompt.includes('Lance le plan.'))!;
  expect(launched.lastIndexOf('[mode] Plume')).toBeGreaterThan(launched.lastIndexOf('Voici le plan.'));
});
