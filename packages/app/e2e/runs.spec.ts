/**
 * What the project runs (task 10.3), end to end: the browser's new tab lists the scripts of the project's
 * package.json that serve a page — never one whose name is a command line — and « Lancer et ouvrir » starts one
 * (hidden, without a shell) and opens its page once it answers.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

/** A dev server: it listens on a free port, says its address, and serves a page titled « Dev ». */
const SERVER = [
  "const server = require('http').createServer((request, response) => response.end('<title>Dev</title><p>servi</p>'));",
  "server.listen(0, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + server.address().port + '/'));",
].join('\n');

test('the new tab lists what the project serves; « Lancer et ouvrir » starts it and opens its page', async ({ launch }) => {
  const { page, home } = await launch({ engine: { responder: () => 'ok' } });
  await writeFile(join(home, 'server.js'), SERVER);
  // npm runs a script through the system's shell: the script is a file, nothing to quote.
  await writeFile(join(home, 'package.json'), JSON.stringify({ name: 'maison', scripts: { dev: 'node server.js', test: 'node -e 0', 'dev & calc': 'node -e 0' } }));
  await expect(chat(page).editor).toBeVisible();
  await page.getByRole('group', { name: 'Volets' }).getByRole('button', { name: 'Navigateur' }).click();

  const inProject = page.getByRole('region', { name: 'Dans ce projet' });
  await expect(inProject).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Ce que maison sait faire tourner/)).toBeVisible();
  // A server script is offered; a test script belongs to the terminal; a name that is a command line, nowhere.
  await expect(inProject.locator('[data-run]')).toHaveCount(1);
  const dev = inProject.locator('[data-run="dev"]');
  await expect(dev).toContainText('npm dev');
  await expect(dev).toContainText('Arrêté');

  await dev.getByRole('button', { name: 'Lancer et ouvrir' }).click();
  await expect(page.getByRole('tab', { name: /Dev/ })).toBeVisible({ timeout: 30_000 });
});
