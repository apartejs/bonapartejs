/**
 * A question of the agent, end to end (board « Une question de l'agent »):
 * the model calls ask_user — the window's tool, announced to it in a note —,
 * the core pauses the turn for the window, the question takes the composer's
 * place with its choices; the answer goes back to the model, the turn goes
 * on, and the question stays in the thread with its answer. « Laisse-le
 * choisir » leaves the choice to the model.
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const ASK =
  `<|tool_call>call:ask_user{questions:[{question:${Q}Quel séparateur pour le CSV ?${Q},header:${Q}Séparateur${Q},` +
  `options:[{title:${Q}Point-virgule${Q}},{title:${Q}Virgule${Q}}]}]}<tool_call|>`;

function model(prompt: string): string {
  const user = prompt.lastIndexOf('<|turn>user');
  const response = prompt.lastIndexOf('<|tool_response>');
  if (response > user) return prompt.slice(response).includes('declined') ? 'Je choisis la virgule.' : 'Noté.';
  return prompt.slice(user).includes('séparateur') ? ASK : 'ok';
}

test('the question takes the composer’s place; the answer reaches the model, and stays in the thread', async ({ launch }) => {
  const prompts: string[] = [];
  const { page } = await launch({ engine: { responder: model, onCompletion: (body) => prompts.push(String(body['prompt'])) } });
  const ui = chat(page);
  await ui.send('Choisis le séparateur avec moi');

  const question = ui.question;
  await expect(question).toContainText('Quel séparateur pour le CSV ?', { timeout: 15_000 });
  // The model was told the tool exists before it called it.
  expect(prompts[0]).toContain('ask_user');
  await question.getByRole('button', { name: 'Point-virgule', exact: true }).click();

  await expect(ui.replyText).toHaveText('Noté.', { timeout: 15_000 });
  expect(prompts.at(-1)!.slice(prompts.at(-1)!.lastIndexOf('<|tool_response>'))).toContain('Point-virgule');
  await expect(ui.replies.last()).toContainText('Quel séparateur pour le CSV ?');
  await expect(ui.replies.last()).toContainText('Point-virgule');
});

test('« Laisse-le choisir »: the model is told the person left it the choice', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: model } });
  const ui = chat(page);
  await ui.send('Choisis le séparateur avec moi');
  const question = ui.question;
  await expect(question).toContainText('Quel séparateur pour le CSV ?', { timeout: 15_000 });
  await question.getByRole('button', { name: 'Laisse-le choisir' }).click();
  await expect(ui.replyText).toHaveText('Je choisis la virgule.', { timeout: 15_000 });
});

test('the keys answer it: 2 is the second choice, Escape leaves the choice to the model', async ({ launch }) => {
  // aparté 1.10's keys (apartejs/aparte#223), while one of the choices has the focus.
  const prompts: string[] = [];
  const { page } = await launch({ engine: { responder: model, onCompletion: (body) => prompts.push(String(body['prompt'])) } });
  const ui = chat(page);
  await ui.send('Choisis le séparateur avec moi');
  await expect(ui.question).toContainText('Quel séparateur pour le CSV ?', { timeout: 15_000 });
  await ui.question.getByRole('button', { name: 'Point-virgule', exact: true }).focus();
  await page.keyboard.press('2');
  await expect(ui.replyText).toHaveText('Noté.', { timeout: 15_000 });
  const answered = prompts.at(-1)!.slice(prompts.at(-1)!.lastIndexOf('<|tool_response>'));
  expect(answered).toContain('Virgule');
  expect(answered).not.toContain('Point-virgule');

  await ui.send('Choisis le séparateur avec moi');
  await expect(ui.question).toContainText('Quel séparateur pour le CSV ?', { timeout: 15_000 });
  await ui.question.getByRole('button', { name: 'Virgule', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(ui.replyText).toHaveText('Je choisis la virgule.', { timeout: 15_000 });
});
