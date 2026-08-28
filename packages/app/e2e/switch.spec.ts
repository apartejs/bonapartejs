/**
 * Switching conversation from the sidebar must replace the chat content.
 *
 * Reported by Paul on 2026-08-28: clicking another conversation marked it
 * active in the sidebar but the thread on screen stayed the previous one.
 * The chat component seeds the library with the conversation's messages
 * once, at mount; without a remount per conversation, the seed of the first
 * conversation stayed on screen for every other one.
 *
 * Read-only path: the fixture configures an engine but no model is loaded —
 * browsing conversations must not wake anything.
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;

test.beforeAll(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-switch-'));
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
  const at = new Date().toISOString();
  await store.create('conv-a', { title: 'Alpha' });
  await store.appendEvent('conv-a', { type: 'user', text: 'ALPHA message', at });
  await store.create('conv-b', { title: 'Bravo' });
  await store.appendEvent('conv-b', { type: 'user', text: 'BRAVO message', at });

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

test('clicking another conversation replaces the thread on screen', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  await expect(window.locator('body')).toContainText('ALPHA message');

  await window.locator('.conv-item', { hasText: 'Bravo' }).click();

  await expect(window.locator('.conv-item-active')).toContainText('Bravo');
  await expect(window.locator('body')).toContainText('BRAVO message');
  await expect(window.locator('body')).not.toContainText('ALPHA message');
});
