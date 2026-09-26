/**
 * Organising conversations (P2.7, criterion 5): pin, archive, search,
 * duplicate and branch. A duplicate or a branch starts where its parent
 * was — the frozen prompt, the log up to the turn, and the parent's saved
 * context, so it resumes from the cache.
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let dataDir: string;

test.beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-organise-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({
      backend: { mode: 'managed', binPath: 'llama' },
      currentConversationId: 'conv-alpha',
      locale: 'en',
    }),
  );
  const store = new ConversationStore(join(dataDir, 'conversations'));
  const at = new Date().toISOString();
  await store.create('conv-alpha', { title: 'Alpha plans' });
  await store.freezeBackendState('conv-alpha', { systemPrompt: 'FROZEN' }, []);
  await store.appendEvent('conv-alpha', { type: 'user', text: 'FIRST question', at });
  await store.appendEvent('conv-alpha', {
    type: 'assistant',
    entry: { role: 'assistant', text: 'FIRST answer', raw: 'FIRST answer' },
    at,
  });
  await store.appendEvent('conv-alpha', { type: 'user', text: 'SECOND question', at });
  await store.appendEvent('conv-alpha', {
    type: 'assistant',
    entry: { role: 'assistant', text: 'SECOND answer', raw: 'SECOND answer' },
    at,
  });
  await store.create('conv-bravo', { title: 'Bravo notes' });
  await store.create('conv-charlie', { title: 'Charlie ideas' });
  // Alpha has a saved context: a duplicate inherits it.
  await mkdir(join(dataDir, 'kv-slots'), { recursive: true });
  await writeFile(join(dataDir, 'kv-slots', 'conv-alpha.slot'), 'STATE');
  await writeFile(
    join(dataDir, 'kv-slots', 'conv-alpha.manifest.json'),
    JSON.stringify({ schemaVersion: 1, conversationId: 'conv-alpha', promptTokenCount: 50 }),
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

async function rowAction(name: string, action: RegExp): Promise<void> {
  const window = await app.firstWindow();
  const row = window.locator('.conv-row', { hasText: name });
  await row.hover();
  await row.locator('.conv-row-menu').click();
  await window.getByRole('menuitem', { name: action }).click();
}

test('pinned conversations come first; archived ones leave the list until asked for', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();

  await rowAction('Charlie ideas', /^pin$/i);
  await expect(window.locator('.conv-pinned')).toContainText('Charlie ideas');

  await rowAction('Bravo notes', /^archive$/i);
  await expect(window.locator('.conv-item', { hasText: 'Bravo notes' })).toHaveCount(0);

  await window.getByRole('button', { name: 'Organise' }).click();
  await window.getByRole('menuitemcheckbox', { name: /show archived \(1\)/i }).click();
  await window.keyboard.press('Escape');
  await expect(window.locator('.conv-item', { hasText: 'Bravo notes' })).toContainText('archived');
});

test('the search narrows the list as you type, and Escape clears it', async () => {
  const window = await app.firstWindow();
  const search = window.getByRole('textbox', { name: 'Search conversations' });
  await search.fill('alpha');
  await expect(window.locator('.conv-item')).toHaveCount(1);
  await expect(window.locator('.conv-item')).toContainText('Alpha plans');
  await search.press('Escape');
  await expect(window.locator('.conv-item', { hasText: 'Charlie ideas' })).toBeVisible();
});

test('a duplicate starts where the parent is — its log, its frozen prompt, its saved context', async () => {
  const window = await app.firstWindow();
  await rowAction('Alpha plans', /^duplicate$/i);

  await expect(window.locator('.conv-item-active')).toContainText('Alpha plans (copy)');
  await expect(window.locator('body')).toContainText('SECOND answer');
  await expect(window.locator('.conv-item-active .conv-branch')).toBeVisible();

  const ids = (await readdir(join(dataDir, 'conversations'))).filter(
    (id) => !['conv-alpha', 'conv-bravo', 'conv-charlie'].includes(id),
  );
  expect(ids).toHaveLength(1);
  const meta = JSON.parse(await readFile(join(dataDir, 'conversations', ids[0]!, 'meta.json'), 'utf8')) as {
    parentId: string;
    backendState: unknown;
  };
  expect(meta).toMatchObject({ parentId: 'conv-alpha', backendState: { systemPrompt: 'FROZEN' } });
  expect(await readFile(join(dataDir, 'kv-slots', `${ids[0]}.slot`), 'utf8')).toBe('STATE');
});

test('"Branch from here" on an answer starts a conversation that stops at that turn', async () => {
  const window = await app.firstWindow();
  await window.locator('.conv-item', { hasText: /^Alpha plans(?! \()/ }).first().click();
  await expect(window.locator('body')).toContainText('FIRST answer');

  const firstAnswer = window.locator('aparte-chat-bubble', { hasText: 'FIRST answer' });
  await firstAnswer.hover();
  await firstAnswer.getByRole('button', { name: 'Branch from here' }).click();

  await expect(window.locator('.conv-item-active')).toContainText('Alpha plans (branch)');
  await expect(window.locator('body')).toContainText('FIRST answer');
  await expect(window.locator('body')).not.toContainText('SECOND question');
});
