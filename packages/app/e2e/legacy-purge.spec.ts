/**
 * Conversations of the old shape (a `projectRoot` key, before projects)
 * are purged at launch — and only they: a conversation merely TITLED
 * "projectRoot" is the user's. From the adversarial review of 2026-09-26.
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { _electron as electron, expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('an old-shape conversation is purged; one titled "projectRoot" is kept', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-purge-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({ backend: { mode: 'managed', binPath: 'llama' }, locale: 'en', currentConversationId: 'conv-kept' }),
  );
  const store = new ConversationStore(join(dataDir, 'conversations'));
  await store.create('conv-kept', { title: 'projectRoot' });
  await mkdir(join(dataDir, 'conversations', 'conv-old'), { recursive: true });
  await writeFile(
    join(dataDir, 'conversations', 'conv-old', 'meta.json'),
    JSON.stringify({ id: 'conv-old', title: 'Old', projectRoot: 'C:/repo', createdAt: 'x', updatedAt: 'x' }),
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || value === undefined) continue;
    env[key] = value;
  }
  env['BONAPARTE_DATA_DIR'] = dataDir;
  env['BONAPARTE_E2E'] = '1';
  const app = await electron.launch({ args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')], env });
  try {
    const window = await app.firstWindow();
    await window.locator('.app-shell').waitFor();
    await expect(window.locator('.conv-item', { hasText: 'projectRoot' })).toBeVisible();
    expect(existsSync(join(dataDir, 'conversations', 'conv-old'))).toBe(false);
    expect(existsSync(join(dataDir, 'conversations', 'conv-kept'))).toBe(true);
  } finally {
    await app.close();
  }
});
