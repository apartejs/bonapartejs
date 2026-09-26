/**
 * A tool that needs consent asks for it on the library's approval panel —
 * inline in the composer, where the answer is typed — and a refusal ends
 * the round-trip without running anything.
 *
 * The engine is the fake llama-server, joined as a remote endpoint; it
 * answers the first turn with a Hermes tool call and the next one with a
 * word.
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
  let turn = 0;
  server = await startFakeLlamaServer({ responder: () => (turn++ === 0 ? TOOL_CALL : 'after refusal') });

  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-approval-'));
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
  const store = new ConversationStore(join(dataDir, 'conversations'));
  await store.create('conv-a', { title: 'Alpha' });

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

test('a command asks on the library panel; refusing ends the round-trip', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();

  const editor = window.locator('.aparte-ci-editor');
  await editor.fill('run something');
  await editor.press('Enter');

  // The library's approval panel, with OUR options — and an "always" that
  // says what it covers: this exact line, or every command of its program.
  const options = window.locator('.aparte-approval-option');
  await expect(options).toHaveCount(4, { timeout: 10_000 });
  await expect(options.first()).toHaveText('Allow');
  await expect(options.nth(1)).toContainText('Always allow this command');
  await expect(options.nth(1)).toContainText('echo hi');
  await expect(options.nth(2)).toContainText('Always allow echo');
  await expect(options.nth(2)).toContainText('Every echo command in this project');
  await expect(window.locator('.modal-card')).toHaveCount(0);

  await options.filter({ hasText: 'Refuse' }).click();

  await expect(options).toHaveCount(0);
  await expect(window.locator('.chat-wrap')).toContainText('after refusal', { timeout: 10_000 });
});
