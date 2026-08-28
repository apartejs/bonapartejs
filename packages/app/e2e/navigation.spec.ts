/**
 * A generation survives navigation (D-24, P1.5).
 *
 * Browsing another conversation while a reply streams must neither cut the
 * stream nor lose it: the reply completes, is persisted, and the screen
 * that comes back shows all of it.
 *
 * The engine is the fake llama-server, joined as a remote endpoint, paced so
 * the reply takes about two seconds to arrive.
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { startFakeLlamaServer, type FakeLlamaServer } from '@aparte/bonaparte-core/testing';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPLY = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen';

let app: ElectronApplication;
let server: FakeLlamaServer;

test.beforeAll(async () => {
  server = await startFakeLlamaServer({ paceMs: 120, responder: () => REPLY });

  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-nav-'));
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
  const at = new Date().toISOString();
  await store.create('conv-a', { title: 'Alpha' });
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
  await server?.close();
});

test('a reply streaming in one conversation completes while another is read, and is all there on return', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();

  const editor = window.locator('.aparte-ci-editor');
  await editor.fill('count for me');
  await editor.press('Enter');
  // The stream has started: the first words are on screen, the last are not.
  await expect(window.locator('body')).toContainText('one two');
  await expect(window.locator('body')).not.toContainText('fifteen');

  // Navigation, mid-stream.
  await window.locator('.conv-item', { hasText: 'Bravo' }).click();
  const thread = window.locator('.chat-wrap');
  await expect(thread).toContainText('BRAVO message');
  // The first message titled A in the sidebar: the THREAD is what must be B's.
  await expect(thread).not.toContainText('count for me');

  // Back: the whole reply, including what arrived while we were away.
  // The first message titled the conversation: 'Alpha' is 'count for me' now.
  await window.locator('.conv-item', { hasText: 'count for me' }).click();
  await expect(thread).toContainText('count for me');
  await expect(thread).toContainText(REPLY, { timeout: 10_000 });
});
