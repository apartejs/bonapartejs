/**
 * The composer's own row — what conditions the NEXT message: the play mode,
 * the reasoning switch, the temperature, the model. Written before those
 * controls moved to shadcn/ui: this is what they must keep doing whatever
 * dresses them.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;

test.beforeAll(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-composer-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({ backend: { mode: 'managed', binPath: 'llama' }, locale: 'en', mode: 'repetition' }),
  );

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || value === undefined) continue;
    env[key] = value;
  }
  env['BONAPARTE_DATA_DIR'] = dataDir;
  env['BONAPARTE_E2E'] = '1';

  app = await electron.launch({
    args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')],
    env,
  });
});

test.afterAll(async () => {
  await app?.close();
});

test('the play mode is chosen from a menu that names what each mode allows', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();

  const button = window.locator('.mode-button');
  await expect(button).toContainText('Rehearsal');
  await button.click();
  const improv = window.getByRole('menuitemradio', { name: /Improv/ });
  await expect(improv).toContainText('without asking');
  await improv.click();
  await expect(button).toContainText('Improv');
  // The menu closes with an animation, then hands the focus back to its
  // trigger: the next test must not open a popover before that (the focus
  // coming back would dismiss it — only a test clicks that fast).
  await expect(window.getByRole('menu')).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('the reasoning switch is a pressed button', async () => {
  const window = await app.firstWindow();
  const think = window.locator('.think-button');
  await expect(think).toHaveAttribute('aria-pressed', 'true');
  await think.click();
  await expect(think).toHaveAttribute('aria-pressed', 'false');
  await think.click();
  await expect(think).toHaveAttribute('aria-pressed', 'true');
});

test('the temperature is set for this conversation from its slider, and reverts', async () => {
  const window = await app.firstWindow();
  const button = window.locator('.temp-button');
  await button.click();
  const panel = window.getByRole('dialog', { name: 'Temperature' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('.temp-origin')).toContainText('inherited');

  const slider = panel.getByRole('slider');
  await slider.focus();
  await window.keyboard.press('ArrowRight');
  await expect(panel.locator('.temp-origin')).toContainText('set for this conversation');
  await panel.getByRole('button', { name: 'Reset' }).click();
  await expect(panel.locator('.temp-origin')).toContainText('inherited');
  // A click elsewhere closes it.
  await window.locator('.chat-wrap').click({ position: { x: 20, y: 20 } });
  await expect(panel).toBeHidden();
});

test('Escape closes the temperature panel', async () => {
  const window = await app.firstWindow();
  await window.locator('.temp-button').click();
  const panel = window.getByRole('dialog', { name: 'Temperature' });
  await expect(panel).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('the model menu lists the machine, and warns that switching rebuilds the context', async () => {
  const window = await app.firstWindow();
  await window.locator('.model-button').click();
  const menu = window.locator('.model-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Choose a model');
  // Either the machine has models — and switching is explained — or it has none, and that is said.
  await expect(menu).toContainText(/Switching models rebuilds the context|No model found on this machine/, {
    timeout: 10_000,
  });
  await window.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});
