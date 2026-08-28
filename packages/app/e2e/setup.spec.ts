/**
 * The first screen: connecting the engine. An existing llama-server is
 * checked before it is accepted, and the curtain rises on the shell.
 * Written before the screen moved to shadcn/ui: this is what it must keep
 * doing whatever dresses it.
 */

import { startFakeLlamaServer, type FakeLlamaServer } from '@aparte/bonaparte-core/testing';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let server: FakeLlamaServer;

test.beforeAll(async () => {
  server = await startFakeLlamaServer({ responder: () => 'hello from the wings' });

  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-setup-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  // No engine configured: the app opens on the setup screen.
  await writeFile(join(dataDir, 'config', 'global.json'), JSON.stringify({ locale: 'en' }));

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
  await server?.close();
});

test('an existing server is checked, recognised, and the curtain rises', async () => {
  const window = await app.firstWindow();
  const card = window.locator('.setup-card');
  await card.waitFor();
  await expect(card.getByRole('heading', { name: 'Connect the engine' })).toBeVisible();

  await card.getByRole('tab', { name: 'I already have a server' }).click();
  const url = card.getByPlaceholder('http://127.0.0.1:1234/v1');
  await url.fill(server.url);
  await card.getByRole('button', { name: 'Check' }).click();
  await expect(card).toContainText('llama.cpp recognised', { timeout: 10_000 });

  await card.getByRole('button', { name: 'Raise the curtain' }).click();
  await window.locator('.app-shell').waitFor({ timeout: 15_000 });
  await expect(window.locator('.status-strip')).toBeVisible();
});
