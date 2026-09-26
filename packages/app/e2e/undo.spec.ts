/**
 * The safety net (06 §1 D): the files a turn wrote are listed at the end
 * of its bubble, with a way back. Undo puts them back on disk, says so,
 * and the model is told; a reload shows the turn as undone.
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { startFakeLlamaServer, type FakeLlamaServer } from '@aparte/bonaparte-core/testing';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WRITE = '<tool_call>{"name": "write_file", "arguments": {"path": "a.txt", "content": "NEW CONTENT"}}</tool_call>';

let app: ElectronApplication;
let server: FakeLlamaServer;
let repo: string;
let dataDir: string;

test.beforeAll(async () => {
  server = await startFakeLlamaServer({
    paceMs: 5,
    responder: (prompt) => {
      const lastUser = prompt.slice(prompt.lastIndexOf('<|im_start|>user'));
      return lastUser.includes('[tool result:') ? 'written' : WRITE;
    },
  });
  dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-undo-'));
  repo = join(dataDir, 'repo');
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, 'a.txt'), 'OLD CONTENT', 'utf8');
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({
      backend: { mode: 'remote', url: server.url },
      currentConversationId: 'conv-a',
      locale: 'en',
      mode: 'impro',
      settings: { thinking: false },
    }),
  );
  await writeFile(
    join(dataDir, 'projects.json'),
    JSON.stringify({ version: 1, projects: [{ id: 'p', name: 'repo', roots: [repo], createdAt: 'x', updatedAt: 'x' }] }),
  );
  const store = new ConversationStore(join(dataDir, 'conversations'));
  await store.create('conv-a', { title: 'Edits', projectId: 'p' });
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

test('a turn that wrote a file lists it with an undo; undo puts it back and the model is told', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  const editor = window.locator('.aparte-ci-editor');
  await editor.fill('rewrite a.txt');
  await editor.press('Enter');

  const changes = window.locator('.bp-changes');
  await expect(changes).toContainText('Changed a.txt', { timeout: 10_000 });
  expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('NEW CONTENT');

  await changes.getByRole('button', { name: 'Undo these changes' }).click();

  await expect(changes).toContainText('Changes undone');
  await expect(changes.getByRole('button')).toBeHidden();
  expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('OLD CONTENT');
  const log = await readFile(join(dataDir, 'conversations', 'conv-a', 'log.jsonl'), 'utf8');
  expect(log).toContain('[user action]');
});

test('after a reload the turn reads as undone — no undo button left', async () => {
  const window = await app.firstWindow();
  await window.reload();
  await window.locator('.app-shell').waitFor();
  const changes = window.locator('.bp-changes');
  await expect(changes).toContainText('Changes undone');
  await expect(changes.getByRole('button')).toBeHidden();
});
