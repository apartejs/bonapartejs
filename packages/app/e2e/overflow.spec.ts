/**
 * The context is finite, and the server never shifts it behind our back
 * (D-22): a prompt the server refuses as too long is said in the thread as
 * what it is — the context is full — not as a raw HTTP error.
 *
 * A remote engine declares no context size, so the proactive estimate
 * cannot refuse first; this is the reactive half, the safety net.
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
  // Smaller than any system prompt: every completion is refused.
  server = await startFakeLlamaServer({ nCtx: 30, responder: () => 'never' });

  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-overflow-'));
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
  await store.create('conv-a', { title: 'Alpha' });

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

test('a prompt the server refuses as too long is announced as a full context', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();

  const editor = window.locator('.aparte-ci-editor');
  await editor.fill('hello');
  await editor.press('Enter');

  const thread = window.locator('.chat-wrap');
  await expect(thread).toContainText('does not fit', { timeout: 10_000 });
  await expect(thread).not.toContainText('llama-server 400');
});
