/**
 * Choosing a model, end to end: the app lists the models it finds, says what
 * loading one costs before anything is launched, loads it on « Démarrer »,
 * and the conversation then runs on the engine it launched — the fake
 * binary, with its key. Quitting stops it.
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const MODELS = {
  'gemma-4-e2e': { paddingBytes: 3 * 1024 * 1024 },
  'vieux-gemma': { chatTemplate: "{{ '<start_of_turn>' + role }}" },
};

/** Does anything answer on the engine's port? */
async function engineAnswers(port: number): Promise<boolean> {
  return fetch(`http://127.0.0.1:${port}/health`).then(
    (response) => response.ok,
    () => false,
  );
}

test('lists the models found, says what loading costs, and loads nothing before « Démarrer »', async ({ launch }) => {
  const { page, enginePort } = await launch({ managed: { models: MODELS } });

  await expect(page.getByRole('heading', { name: 'Préparons le moteur' })).toBeVisible();
  await expect(page.getByText('Rien n’est chargé ni envoyé avant ton clic.')).toBeVisible();
  const gemma = page.getByRole('radio', { name: /gemma-4-e2e/ });
  await expect(gemma).toBeChecked();
  await expect(page.locator('.model-row', { hasText: 'gemma-4-e2e' })).toContainText('tient');

  // A model the built-in engine cannot speak is shown, and says what to do.
  await expect(page.getByRole('radio', { name: /vieux-gemma/ })).toBeDisabled();
  await expect(page.locator('.model-row', { hasText: 'vieux-gemma' })).toContainText('passe par un service existant');

  // The cost, before anything is paid.
  await expect(page.locator('.engine-announcement')).toHaveText(
    /^Chargement ~\d+ s \(estimé\) · [\d,]+ [GM]o de mémoire vidéo sur 24 Go$/,
  );
  // Nothing was asked of the engine: a load that has just begun says « starting » at once,
  // before anything answers on its port.
  const state = await page.evaluate(() => {
    const preload = window as unknown as { bonaparte: { invoke(name: string, input: unknown): Promise<unknown> } };
    return preload.bonaparte.invoke('engine.state', undefined);
  });
  expect(state).toEqual({ mode: 'managed', status: 'stopped' });
  expect(await engineAnswers(enginePort!)).toBe(false);
});

test('« Démarrer » loads the model, and the conversation runs on it', async ({ launch }) => {
  const { page, enginePort } = await launch({ managed: { models: MODELS } });
  await page.getByRole('button', { name: 'Démarrer' }).click();

  const ui = chat(page);
  await expect(ui.composer('Réponds, ou demande autre chose…')).toBeVisible({ timeout: 20_000 });
  expect(await engineAnswers(enginePort!)).toBe(true);

  await ui.send('Bonjour');
  // The fake binary answers « ok »: the reply came from the engine the app launched.
  await expect(ui.replyText).toHaveText('ok', { timeout: 15_000 });
  await expect(ui.errors).toHaveCount(0);
});

test('quitting the app stops the engine it launched', async ({ launch }) => {
  const launched = await launch({ managed: { models: MODELS } });
  await launched.page.getByRole('button', { name: 'Démarrer' }).click();
  await expect(chat(launched.page).editor).toBeVisible({ timeout: 20_000 });
  expect(await engineAnswers(launched.enginePort!)).toBe(true);

  // Quit as the person does — not as Playwright closes, which kills the whole
  // tree of processes on Windows and would stop the engine whatever the app did.
  // On Windows a child dies with the app anyway (libuv's job object): this test
  // can only fail where the server runs detached, on Linux and macOS. The rule
  // itself is pinned by src/main/quit.spec.ts.
  const main = launched.app.process();
  const exited = new Promise<void>((resolve) => main.once('exit', () => resolve()));
  await launched.app.evaluate(({ app }) => app.quit()).catch(() => undefined);
  await exited;
  await expect.poll(() => engineAnswers(launched.enginePort!), { timeout: 10_000 }).toBe(false);
});

test('a load that fails says so, and keeps what the engine said', async ({ launch }) => {
  const { page } = await launch({
    managed: { models: MODELS },
    env: { FAKE_LLAMA_FAIL: 'impossible de charger le modèle' },
  });
  await page.getByRole('button', { name: 'Démarrer' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText("Le moteur n’a pas démarré.", { timeout: 20_000 });
  await expect(alert).toContainText('impossible de charger le modèle');
  // The choice is still there, to try again or choose another.
  await expect(page.getByRole('button', { name: 'Démarrer' })).toBeEnabled();
});

test('the screen speaks English when the app does', async ({ launch }) => {
  const { page } = await launch({ locale: 'en', managed: { models: MODELS } });
  await expect(page.getByRole('heading', { name: 'Let’s set up the engine' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  await expect(page.locator('.engine-announcement')).toHaveText(
    /^Loading ~\d+ s \(estimated\) · [\d.]+ [GM]B of video memory out of 24 GB$/,
  );
});
