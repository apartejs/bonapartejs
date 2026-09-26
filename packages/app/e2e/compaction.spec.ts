/**
 * Compaction is the rebase (P2.5, D-19), and it is announced before it is
 * paid: from the header's menu (or offered when the context is full), a
 * confirmation says what happens; the model writes a summary; the thread
 * keeps every turn, the compaction marked; the next message starts from
 * the summary.
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { startFakeLlamaServer, type FakeLlamaServer } from '@aparte/bonaparte-core/testing';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let server: FakeLlamaServer;
let dataDir: string;

test.beforeAll(async () => {
  server = await startFakeLlamaServer({
    responder: (prompt) => {
      if (prompt.includes('Summarize this conversation')) return 'THE SUMMARY OF EVERYTHING';
      return prompt.includes('THE SUMMARY OF EVERYTHING') ? 'continued from the summary' : 'a plain answer';
    },
  });
  dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-compaction-'));
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
  await store.create('conv-a', { title: 'Long one' });
  for (const n of [1, 2, 3]) {
    await store.appendEvent('conv-a', { type: 'user', text: `QUESTION ${n}`, at });
    await store.appendEvent('conv-a', {
      type: 'assistant',
      entry: { role: 'assistant', text: `ANSWER ${n}`, raw: `ANSWER ${n}` },
      at,
    });
  }
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

test('compacting asks first, marks the compaction in the thread, and the next message starts from the summary', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  await expect(window.locator('.chat-wrap')).toContainText('ANSWER 3');

  await window.locator('.conv-header-more').click();
  await window.getByRole('menuitem', { name: 'Compact the conversation…' }).click();
  const dialog = window.getByRole('dialog');
  await expect(dialog).toContainText('Compact this conversation?');
  await expect(dialog).toContainText('Every message stays on your screen');
  await dialog.getByRole('button', { name: 'Compact' }).click();

  // The thread keeps every turn, and says what happened.
  await expect(window.locator('.chat-wrap')).toContainText('The earlier turns were compacted', { timeout: 15_000 });
  await expect(window.locator('.chat-wrap')).toContainText('QUESTION 1');
  const log = await readFile(join(dataDir, 'conversations', 'conv-a', 'log.jsonl'), 'utf8');
  expect(log).toContain('"type":"rebase"');
  expect(log).toContain('THE SUMMARY OF EVERYTHING');

  const editor = window.locator('.aparte-ci-editor');
  await editor.fill('and now?');
  await editor.press('Enter');
  await expect(window.locator('.chat-wrap')).toContainText('continued from the summary', { timeout: 10_000 });
});
