/**
 * Project instructions reach the model (06 §2, must-have): an AGENTS.md at
 * the project's root is frozen into the conversation's system prompt, and
 * the header's project panel says which file the model follows.
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
  server = await startFakeLlamaServer({
    responder: (prompt) => (prompt.includes('ALWAYS ANSWER IN HAIKU') ? 'instructions seen' : 'instructions missing'),
  });
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-instructions-'));
  const repo = join(dataDir, 'repo');
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, 'AGENTS.md'), '# House rules\nALWAYS ANSWER IN HAIKU.\n');

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
  await writeFile(
    join(dataDir, 'projects.json'),
    JSON.stringify({
      version: 1,
      projects: [{ id: 'proj-repo', name: 'repo', roots: [repo], createdAt: 'x', updatedAt: 'x' }],
    }),
  );
  const store = new ConversationStore(join(dataDir, 'conversations'));
  await store.create('conv-a', { title: 'In the repo', projectId: 'proj-repo' });

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

test('the header says which instructions file the model follows', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  await window.locator('.conv-header').getByRole('button', { name: /repo/ }).first().click();
  await expect(window.locator('.conv-popover-instructions')).toContainText('The model follows AGENTS.md');
  await window.keyboard.press('Escape');
});

test('the AGENTS.md of the project is in the prompt the model receives', async () => {
  const window = await app.firstWindow();
  const editor = window.locator('.aparte-ci-editor');
  await editor.fill('hello');
  await editor.press('Enter');
  await expect(window.locator('.chat-wrap')).toContainText('instructions seen', { timeout: 10_000 });
});
