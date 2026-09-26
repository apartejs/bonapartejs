/**
 * A turn that ends while bonaparte is not in front says so (06 §6): a local
 * model takes minutes, and whoever went elsewhere should know when to come
 * back. The E2E window is never in front — the notification is recorded.
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { startFakeLlamaServer, type FakeLlamaServer } from '@aparte/bonaparte-core/testing';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let server: FakeLlamaServer;

test.beforeAll(async () => {
  server = await startFakeLlamaServer({ responder: () => 'done thinking' });
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-notify-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({
      backend: { mode: 'remote', url: server.url },
      currentConversationId: 'conv-a',
      locale: 'en',
      settings: { thinking: false },
    }),
  );
  const store = new ConversationStore(join(dataDir, 'conversations'));
  await store.create('conv-a', { title: 'Long refactor' });

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || value === undefined) continue;
    env[key] = value;
  }
  env['BONAPARTE_DATA_DIR'] = dataDir;
  env['BONAPARTE_E2E'] = '1';
  app = await electron.launch({ args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')], env });
});

test.afterAll(async () => {
  await app?.close();
  await server?.close();
});

test('a reply finishing while the window is not in front is notified, naming the conversation', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  const editor = window.locator('.aparte-ci-editor');
  await editor.fill('go ahead');
  await editor.press('Enter');
  await expect(window.locator('.chat-wrap')).toContainText('done thinking', { timeout: 10_000 });

  await expect
    .poll(() =>
      app.evaluate(
        () =>
          (globalThis as { __bonaparteNotifications?: { conversationId: string; body: string }[] })
            .__bonaparteNotifications ?? [],
      ),
    )
    .toEqual([{ conversationId: 'conv-a', body: 'The reply is ready in “go ahead”.' }]);
});
