/**
 * An approval waits in one conversation while the user is in another
 * (Ctrl+N, a notification, the sidebar): the screen says who waits, the
 * composer holds instead of sending into a turn that can never start, and
 * the user can go there or stop it. Before, the new message waited for an
 * answer nobody could see, until a restart (adversarial review, 2026-09-26).
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { startFakeLlamaServer, type FakeLlamaServer } from '@aparte/bonaparte-core/testing';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOOL_CALL = '<tool_call>{"name": "run_shell", "arguments": {"command": "echo hi"}}</tool_call>';

let app: ElectronApplication;
let server: FakeLlamaServer;

test.beforeAll(async () => {
  server = await startFakeLlamaServer({
    paceMs: 5,
    responder: (prompt) => {
      const lastUser = prompt.slice(prompt.lastIndexOf('<|im_start|>user'));
      if (lastUser.includes('run something')) return lastUser.includes('[tool result:') ? 'ran' : TOOL_CALL;
      return 'hello from the other conversation';
    },
  });
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-approval-elsewhere-'));
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
  await new ConversationStore(join(dataDir, 'conversations')).create('conv-a', { title: 'Alpha' });
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

test('the waiting conversation is named; Stop frees the one on screen', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  const editor = window.locator('.aparte-ci-editor');
  await editor.fill('run something');
  await editor.press('Enter');
  await expect(window.getByRole('button', { name: 'Allow', exact: true })).toBeVisible({ timeout: 10_000 });

  await window.keyboard.press('Control+n');

  const banner = window.locator('.approval-elsewhere');
  await expect(banner).toContainText('is waiting for your answer', { timeout: 10_000 });
  await expect(banner).toContainText(/Alpha|run something/);
  await banner.getByRole('button', { name: 'Stop it' }).click();
  await expect(banner).toHaveCount(0, { timeout: 10_000 });

  await editor.fill('say hello');
  await editor.press('Enter');
  await expect(window.locator('.chat-wrap')).toContainText('hello from the other conversation', { timeout: 10_000 });
});
