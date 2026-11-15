/**
 * The terminal (board « Conversation au travail », task 6.6): a real shell
 * per tab, in a process of the app's own; « + » adds a tab; the agent's
 * commands show in their own tab, marked « Lancé par l'agent »; killing the
 * terminals' process ends their shells, never the app.
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const Q = '<|"|>';
const RUN = `<|tool_call>call:run_command{program:${Q}${process.execPath}${Q},args:[${Q}-e${Q},${Q}console.log('from the agent')${Q}]}<tool_call|>`;

test('a shell per tab: what is typed runs there; « + » adds one', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'ok' } });
  await expect(chat(page).editor).toBeVisible();
  await page.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Terminal', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Terminaux' });
  const first = tabs.getByRole('tab').first();
  await expect(first).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  const name = (await first.textContent())!.trim();

  const output = page.getByRole('log', { name: `Sortie du terminal ${name}` });
  await output.click();
  await page.keyboard.type('echo bonaparte-terminal');
  await page.keyboard.press('Enter');
  await expect(output).toContainText('bonaparte-terminal', { timeout: 20_000 });

  await page.getByRole('button', { name: 'Nouveau terminal' }).click();
  const second = tabs.getByRole('tab', { name: `${name} 2` });
  await expect(second).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  await expect(first).toHaveAttribute('aria-selected', 'false');
});

test('the agent’s commands show in their own tab, marked as the agent’s', async ({ launch }) => {
  let asked = 0;
  const { page } = await launch({ engine: { responder: () => (asked++ === 0 ? RUN : 'Fait.') } });
  await chat(page).send('Lance le script');
  const card = page.getByRole('region', { name: 'Demande d’accord' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: 'Autoriser', exact: true }).click();
  await expect(chat(page).replyText).toHaveText('Fait.', { timeout: 15_000 });

  await page.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Terminal', exact: true }).click();
  const agent = page.getByRole('tablist', { name: 'Terminaux' }).getByRole('tab', { name: /Lancé par l’agent/ });
  await expect(agent).toBeVisible();
  await agent.click();
  const output = page.getByRole('log', { name: 'Sortie du terminal agent' });
  await expect(output).toContainText('from the agent', { timeout: 10_000 });
  await expect(output).toContainText('[code de sortie 0]');
});

test('killing the terminals’ process ends their shells, never the app; a shell starts again', async ({ launch }) => {
  const launched = await launch({ engine: { responder: () => 'Toujours là.' } });
  const { page } = launched;
  await page.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Terminal', exact: true }).click();
  const first = page.getByRole('tablist', { name: 'Terminaux' }).getByRole('tab').first();
  await expect(first).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  const name = (await first.textContent())!.trim();
  const output = page.getByRole('log', { name: `Sortie du terminal ${name}` });
  await output.click();
  await page.keyboard.type('echo before');
  await page.keyboard.press('Enter');
  await expect(output).toContainText('before', { timeout: 20_000 });

  await launched.app.evaluate(() => {
    (globalThis as { __bonaparteTerminals?: { process(): { kill(): boolean } | undefined } }).__bonaparteTerminals?.process()?.kill();
  });
  await expect(page.getByText('Le shell s’est arrêté.')).toBeVisible({ timeout: 10_000 });
  // The app answers still.
  await chat(page).send('Tu es là ?');
  await expect(chat(page).replyText).toHaveText('Toujours là.', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Relancer' }).click();
  await output.click();
  await page.keyboard.type('echo after');
  await page.keyboard.press('Enter');
  await expect(output).toContainText('after', { timeout: 20_000 });
});
