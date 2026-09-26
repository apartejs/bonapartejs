/**
 * Deleting a conversation from the sidebar: its messages AND its saved
 * state leave the disk — a privacy matter, not only tidying up (security
 * audit, H2). The row's menu asks first; nothing goes on a single click.
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let dataDir: string;

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

test.beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-delete-'));
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
  await store.create('conv-b', { title: 'Bravo secrets' });
  await store.appendEvent('conv-b', { type: 'user', text: 'BRAVO message', at });
  // A saved state for Bravo: it must go with the conversation.
  await mkdir(join(dataDir, 'kv-slots'), { recursive: true });
  await writeFile(join(dataDir, 'kv-slots', 'conv-b.slot'), 'state');
  await writeFile(join(dataDir, 'kv-slots', 'conv-b.manifest.json'), '{}');

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

test('a conversation is deleted from its row menu, after a confirmation, with its saved state', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  const row = window.locator('.conv-row', { hasText: 'Bravo secrets' });
  await row.hover();
  await row.locator('.conv-row-menu').click();
  await window.getByRole('menuitem', { name: /delete/i }).click();

  // The question names what goes, and Cancel keeps it.
  const dialog = window.getByRole('dialog');
  await expect(dialog).toContainText('Bravo secrets');
  await dialog.getByRole('button', { name: /cancel/i }).click();
  await expect(window.locator('.conv-item', { hasText: 'Bravo secrets' })).toBeVisible();

  await row.hover();
  await row.locator('.conv-row-menu').click();
  await window.getByRole('menuitem', { name: /delete/i }).click();
  await window.getByRole('dialog').getByRole('button', { name: /^delete/i }).click();

  await expect(window.locator('.conv-item', { hasText: 'Bravo secrets' })).toHaveCount(0);
  expect(await exists(join(dataDir, 'conversations', 'conv-b'))).toBe(false);
  expect(await exists(join(dataDir, 'kv-slots', 'conv-b.slot'))).toBe(false);
  expect(await exists(join(dataDir, 'kv-slots', 'conv-b.manifest.json'))).toBe(false);
  // The other conversation is untouched, still on screen.
  await expect(window.locator('body')).toContainText('ALPHA message');
});

test('deleting the open conversation moves the screen to another one', async () => {
  const window = await app.firstWindow();
  const row = window.locator('.conv-row', { hasText: 'Alpha' });
  await row.hover();
  await row.locator('.conv-row-menu').click();
  await window.getByRole('menuitem', { name: /delete/i }).click();
  await window.getByRole('dialog').getByRole('button', { name: /^delete/i }).click();

  await expect(window.locator('body')).not.toContainText('ALPHA message');
  expect(await exists(join(dataDir, 'conversations', 'conv-a'))).toBe(false);
  // The screen still shows a conversation — a fresh, empty one.
  await expect(window.locator('.conv-item-active')).toHaveCount(1);
});
