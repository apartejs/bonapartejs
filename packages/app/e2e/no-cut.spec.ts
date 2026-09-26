/**
 * A reply in flight is never cut by a change around it (adversarial review,
 * 2026-09-26): a click on Reasoning, a tool the model makes appear — the
 * turn goes to its end; the change applies from the next message.
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { startFakeLlamaServer, type FakeLlamaServer } from '@aparte/bonaparte-core/testing';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FAKE_MCP = join(import.meta.dirname, '..', '..', 'core', 'src', 'testing', 'fake-mcp-server.mjs');
const LONG = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty the-end';
const GROW = '<tool_call>{"name": "mcp__fake__grow", "arguments": {}}</tool_call>';

let app: ElectronApplication;
let server: FakeLlamaServer;
const prompts: string[] = [];

test.beforeAll(async () => {
  server = await startFakeLlamaServer({
    paceMs: 60,
    responder: (prompt) => {
      prompts.push(prompt);
      const lastUser = prompt.slice(prompt.lastIndexOf('<|im_start|>user'));
      if (lastUser.includes('[tool result: mcp__fake__grow')) return `grown, and ${LONG}`;
      if (lastUser.includes('please grow')) return GROW;
      if (lastUser.includes('count')) return LONG;
      return 'short reply';
    },
  });
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-no-cut-'));
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
    join(dataDir, 'config', 'mcp-servers.json'),
    JSON.stringify({ mcpServers: { fake: { command: process.execPath, args: [FAKE_MCP] } } }),
  );
  await new ConversationStore(join(dataDir, 'conversations')).create('conv-a', { title: 'Counting' });
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

test('a click on Reasoning while the reply streams lets it finish', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  const thread = window.locator('.chat-wrap');
  const editor = window.locator('.aparte-ci-editor');
  await editor.fill('count please');
  await editor.press('Enter');
  await expect(thread).toContainText('one two three', { timeout: 10_000 });

  await window.locator('.think-button').click();

  await expect(thread).toContainText('the-end', { timeout: 10_000 });
});

test('a tool the model makes appear mid-turn: the turn ends, the next message is told of it', async () => {
  const window = await app.firstWindow();
  const thread = window.locator('.chat-wrap');
  const editor = window.locator('.aparte-ci-editor');
  await expect(window.locator('.aparte-ci-editor')).toBeEditable({ timeout: 10_000 });
  await editor.fill('please grow');
  await editor.press('Enter');
  await expect(thread).toContainText('grown, and one two', { timeout: 15_000 });
  await expect(thread.getByText(/grown, and .* the-end/)).toBeVisible({ timeout: 10_000 });

  await editor.fill('say something');
  await editor.press('Enter');
  await expect(thread).toContainText('short reply', { timeout: 10_000 });
  expect(prompts.at(-1)).toContain('mcp__fake__extra');
});
