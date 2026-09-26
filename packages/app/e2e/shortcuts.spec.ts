/**
 * The conversation has its keyboard (06 §1 F, SHOULD): a new conversation,
 * the search, the composer, the settings — VS Code's fingers, where they
 * already are. The hub lists every shortcut.
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;

test.beforeAll(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-shortcuts-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({ backend: { mode: 'managed', binPath: 'llama' }, currentConversationId: 'conv-a', locale: 'en' }),
  );
  const store = new ConversationStore(join(dataDir, 'conversations'));
  await store.create('conv-a', { title: 'Existing one' });
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
});

test('Ctrl+N starts a new conversation', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  await expect(window.locator('.conv-item')).toHaveCount(1);
  await window.keyboard.press('Control+N');
  await expect(window.locator('.conv-item')).toHaveCount(2);
  await expect(window.locator('.conv-item-active')).not.toContainText('Existing one');
});

test('Ctrl+K goes to the search, Ctrl+L to the composer', async () => {
  const window = await app.firstWindow();
  await window.keyboard.press('Control+K');
  await expect(window.getByRole('textbox', { name: 'Search conversations' })).toBeFocused();
  await window.keyboard.press('Control+L');
  await expect(window.locator('.aparte-ci-editor')).toBeFocused();
});

test('Ctrl+, opens the settings, which list the shortcuts', async () => {
  const window = await app.firstWindow();
  await window.keyboard.press('Control+,');
  await expect(window.locator('.settings-hub')).toBeVisible();
  const list = window.locator('.shortcut-list');
  await expect(list).toContainText('New conversation');
  await expect(list).toContainText('Ctrl');
});
