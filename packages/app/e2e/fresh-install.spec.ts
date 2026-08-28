/**
 * A fresh install: an engine, no conversation yet. The first message must
 * get its reply on screen.
 *
 * Every other E2E starts with a current conversation in the config, which
 * hid this: when the first message CREATED the conversation, the screen
 * had been mounted with no id and ignored every event of the new one.
 */

import { startFakeLlamaServer, type FakeLlamaServer } from '@aparte/bonaparte-core/testing';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let server: FakeLlamaServer;

test.beforeAll(async () => {
  server = await startFakeLlamaServer({ responder: () => 'first reply ever' });

  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-fresh-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({
      backend: { mode: 'remote', url: server.url },
      locale: 'en',
      settings: { thinking: false },
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
  await server?.close();
});

test('the very first message of a fresh install gets its reply on screen', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();

  const editor = window.locator('.aparte-ci-editor');
  await editor.fill('hello there');
  await editor.press('Enter');

  const thread = window.locator('.chat-wrap');
  await expect(thread).toContainText('first reply ever', { timeout: 10_000 });
  // The conversation now exists, named by its first message.
  await expect(window.locator('.conv-item')).toContainText('hello there');
});
