/**
 * Files joined to a message (06 §1 B): a text file dropped on the composer
 * travels with the message — the model reads its content — and the thread
 * shows it as a chip, now and after a reload. A file the model cannot read
 * (an image, a binary) is named in a notice, never dropped in silence.
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
    paceMs: 5,
    responder: (prompt) => (prompt.includes('SECRET INSIDE THE FILE') ? 'I read your file' : 'no file seen'),
  });
  dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-attach-'));
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
  await store.create('conv-a', { title: 'Files' });
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

test('a text file dropped on the composer reaches the model; an image is named, not joined', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();

  // A drop, as the browser delivers it: a DataTransfer with two files.
  const dataTransfer = await window.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['// notes\nSECRET INSIDE THE FILE\n'], 'notes.ts', { type: '' }));
    transfer.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', { type: 'image/png' }));
    return transfer;
  });
  await window.locator('aparte-composer').dispatchEvent('drop', { dataTransfer });

  const editor = window.locator('.aparte-ci-editor');
  await editor.fill('what is in this file?');
  await editor.press('Enter');

  await expect(window.locator('.chat-wrap')).toContainText('I read your file', { timeout: 10_000 });
  await expect(window.locator('.attach-skipped')).toContainText('shot.png');
  await expect(window.locator('.attach-skipped')).not.toContainText('notes.ts');

  // The log keeps the message and the file apart: the text as typed.
  const log = await readFile(join(dataDir, 'conversations', 'conv-a', 'log.jsonl'), 'utf8');
  const user = JSON.parse(log.split('\n')[0] as string) as { text: string; attachments: { name: string }[] };
  expect(user.text).toBe('what is in this file?');
  expect(user.attachments.map((file) => file.name)).toEqual(['notes.ts']);
});

test('after a reload, the message shows its file by name — not its content', async () => {
  const window = await app.firstWindow();
  await window.reload();
  await window.locator('.app-shell').waitFor();
  const userBubble = window.locator('aparte-chat-bubble', { hasText: 'what is in this file?' });
  await expect(userBubble).toContainText('notes.ts');
  await expect(userBubble).not.toContainText('SECRET INSIDE THE FILE');
});
