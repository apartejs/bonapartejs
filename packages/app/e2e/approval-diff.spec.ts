/**
 * An approval shows what is being decided (06 §2, must-have): a file edit
 * comes with its diff against the file on disk, not just a path. And a
 * question whose turn is stopped leaves the screen with it.
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { startFakeLlamaServer, type FakeLlamaServer } from '@aparte/bonaparte-core/testing';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDIT =
  '<tool_call>{"name": "edit_file", "arguments": {"path": "notes.txt", "old_string": "hello world", "new_string": "bonjour le monde"}}</tool_call>';
const SHELL = '<tool_call>{"name": "run_shell", "arguments": {"command": "echo waiting"}}</tool_call>';

let app: ElectronApplication;
let server: FakeLlamaServer;
let repo: string;

test.beforeAll(async () => {
  server = await startFakeLlamaServer({
    paceMs: 5,
    responder: (prompt) => {
      const lastUser = prompt.slice(prompt.lastIndexOf('<|im_start|>user'));
      if (lastUser.includes('[tool result:')) return lastUser.includes('declined') ? 'not done' : 'edited';
      return lastUser.includes('edit') ? EDIT : SHELL;
    },
  });
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-approval-diff-'));
  repo = join(dataDir, 'repo');
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, 'notes.txt'), 'first line\nhello world\nlast line\n');

  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({
      backend: { mode: 'remote', url: server.url },
      currentConversationId: 'conv-a',
      locale: 'en',
      mode: 'repetition',
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

test('approving an edit shows its diff — the lines that go, the lines that come', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  const editor = window.locator('.aparte-ci-editor');
  await editor.fill('please edit the notes');
  await editor.press('Enter');

  await expect(window.locator('.aparte-approval-option').first()).toBeVisible({ timeout: 10_000 });
  // The panel's details: the diff, as preformatted text.
  const diff = window.getByText('+bonjour le monde', { exact: false });
  await expect(diff).toBeVisible();
  await expect(diff).toContainText('-hello world');
  await expect(diff).toContainText('first line');
  await expect(diff).toContainText('--- notes.txt');

  await window.locator('.aparte-approval-option', { hasText: /^Allow$/ }).click();
  await expect(window.locator('.chat-wrap')).toContainText('edited', { timeout: 10_000 });
  expect(await readFile(join(repo, 'notes.txt'), 'utf8')).toBe('first line\nbonjour le monde\nlast line\n');
});

test('Stop while a question is open: the panel leaves with the turn', async () => {
  const window = await app.firstWindow();
  const editor = window.locator('.aparte-ci-editor');
  await editor.fill('run the shell thing');
  await editor.press('Enter');
  await expect(window.locator('.aparte-approval-option').first()).toBeVisible({ timeout: 10_000 });

  await window.evaluate(() => window.dispatchEvent(new CustomEvent('aparte-abort')));

  await expect(window.locator('.aparte-approval-option')).toHaveCount(0, { timeout: 10_000 });
});
