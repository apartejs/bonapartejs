/**
 * The project's scripts, one click away — and the page they serve, one
 * more click, inside bonaparte's browser.
 *
 * Reported by Paul on 2026-08-28: the browser offered nothing to launch his
 * package.json scripts. Two causes: at startup the app did not fetch the
 * current conversation's project (the launcher said "open a folder"), and
 * the launcher's "Open" sent the URL to the OS browser.
 *
 * The project is a temporary folder with a `dev` script that announces a
 * URL and stays alive, like a dev server.
 */

import { ConversationStore, ProjectStore } from '@aparte/bonaparte-core';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;

test.beforeAll(async () => {
  const project = await mkdtemp(join(tmpdir(), 'bonaparte-demo-project-'));
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({ name: 'demo', private: true, scripts: { dev: 'node dev.js', test: 'node -e 0' } }),
  );
  await writeFile(
    join(project, 'dev.js'),
    "console.log('  ➜  Local:   http://localhost:5174/');\nsetInterval(() => {}, 1000);\n",
  );

  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-one-click-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  const projects = new ProjectStore(dataDir);
  const demo = await projects.create({ name: 'demo', roots: [project] });
  const store = new ConversationStore(join(dataDir, 'conversations'));
  await store.create('conv-a', { title: 'Alpha' });
  await store.setProjectId('conv-a', demo.id);
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({
      backend: { mode: 'managed', binPath: 'llama' },
      currentConversationId: 'conv-a',
      locale: 'en',
    }),
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

test('the launcher knows the project at startup; one click runs dev, one more opens its page in bonaparte’s browser', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();

  // At startup, the panel's home already offers the project's scripts.
  await expect(window.locator('.tooling-home-script')).toContainText(['dev', 'test']);

  // The launcher tab lists them too — it knows the project from the start.
  await window.locator('.tooling-bar .icon-button').click();
  await window.locator('.tooling-menu-item', { hasText: 'Project' }).click();
  await expect(window.locator('.script-name')).toContainText(['dev', 'test']);

  const dev = window.locator('.script-card', { hasText: 'dev' });
  await dev.getByRole('button', { name: /Run/ }).click();
  // The URL only appears once the server has announced it.
  const openHere = dev.getByRole('button', { name: /Open in the browser/ });
  await expect(openHere).toBeVisible({ timeout: 15_000 });

  await openHere.click();

  await expect(window.locator('.tooling-tab-active')).toContainText('Browser');
  await expect(window.locator('.browser-url')).toHaveValue(/localhost:5174/, { timeout: 10_000 });
});
