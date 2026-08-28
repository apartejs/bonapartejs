/**
 * A conversation pinned to a model whose file has vanished must lead to the
 * model picker, with the vanished file named — not to a raw error in the
 * thread after a failed engine launch.
 *
 * Reported by Paul on 2026-08-28: his conversations all pointed to a GGUF he
 * had deleted; sending a message produced "No model chosen for this
 * conversation." after the engine failed to start.
 *
 * Nothing is launched here: the check happens before any spawn, so the
 * fixture can name `llama` without needing it.
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GONE = 'C:/nowhere/gone.gguf';

let app: ElectronApplication;

test.beforeAll(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-missing-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({
      backend: { mode: 'managed', binPath: 'llama' },
      currentConversationId: 'conv-a',
      locale: 'en',
    }),
  );
  const store = new ConversationStore(join(dataDir, 'conversations'));
  await store.create('conv-a', { title: 'Alpha' });
  await store.appendEvent('conv-a', { type: 'user', text: 'ALPHA message', at: new Date().toISOString() });
  await store.setModel('conv-a', GONE, 8192);

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

test('opening the conversation announces the vanished model', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  await expect(window.locator('body')).toContainText('ALPHA message');

  await expect(window.locator('.missing-model')).toContainText('gone.gguf');
});

test('sending a message leads to the picker, which names the vanished model', async () => {
  const window = await app.firstWindow();

  const editor = window.locator('.aparte-ci-editor');
  await editor.fill('hello again');
  await editor.press('Enter');

  await expect(window.locator('.picker-missing')).toContainText('gone.gguf');
  await expect(window.locator('body')).not.toContainText('No model chosen');
});
