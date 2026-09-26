/**
 * MCP servers, end to end (P4): a server declared in `mcp-servers.json`
 * starts with the app, its tools reach the model, and a call goes to it
 * and back. The hub lists it with its state; a server can be switched off,
 * added from a command line, and removed — the file follows.
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { startFakeLlamaServer, type FakeLlamaServer } from '@aparte/bonaparte-core/testing';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FAKE_MCP = join(import.meta.dirname, '..', '..', 'core', 'src', 'testing', 'fake-mcp-server.mjs');
const CALL = '<tool_call>{"name": "mcp__fake__echo", "arguments": {"text": "hello from mcp"}}</tool_call>';

let app: ElectronApplication;
let server: FakeLlamaServer;
let dataDir: string;
const prompts: string[] = [];

test.beforeAll(async () => {
  server = await startFakeLlamaServer({
    paceMs: 5,
    responder: (prompt) => {
      prompts.push(prompt);
      const lastUser = prompt.slice(prompt.lastIndexOf('<|im_start|>user'));
      return lastUser.includes('[tool result:') ? 'The server said hello.' : CALL;
    },
  });
  dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-mcp-'));
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
  await new ConversationStore(join(dataDir, 'conversations')).create('conv-a', { title: 'Tools' });
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

async function mcpFile(): Promise<{ mcpServers: Record<string, Record<string, unknown>> }> {
  return JSON.parse(await readFile(join(dataDir, 'config', 'mcp-servers.json'), 'utf8')) as {
    mcpServers: Record<string, Record<string, unknown>>;
  };
}

test('a declared server starts with the app; the model calls its tool and reads the answer', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  await window.getByRole('button', { name: 'Settings' }).click();
  const hub = window.locator('.settings-hub');
  await hub.getByRole('button', { name: 'MCP servers' }).click();
  const row = hub.locator('.mcp-row', { hasText: 'fake' });
  await expect(row.locator('.mcp-state')).toHaveText(/connected · \d+ tools/, { timeout: 15_000 });
  await expect(row.locator('.mcp-tools')).toContainText('echo');
  await hub.getByRole('button', { name: 'Close' }).click();

  const editor = window.locator('.aparte-ci-editor');
  await editor.fill('ask the server to say hello');
  await editor.press('Enter');

  const thread = window.locator('.chat-wrap');
  await expect(thread).toContainText('The server said hello.', { timeout: 10_000 });
  const chip = thread.locator('.aparte-segment-tool-call');
  await expect(chip).toContainText('mcp__fake__echo');
  await expect(chip).toHaveAttribute('data-status', 'resolved');
  // The tool was in the prompt's inventory, and its answer went back to the model.
  expect(prompts[0]).toContain('mcp__fake__echo');
  expect(prompts.at(-1)).toContain('hello from mcp');
});

test('switched off, added, removed — from the hub, the file following', async () => {
  const window = await app.firstWindow();
  await window.getByRole('button', { name: 'Settings' }).click();
  const hub = window.locator('.settings-hub');
  await hub.getByRole('button', { name: 'MCP servers' }).click();
  const fake = hub.locator('.mcp-row', { hasText: 'fake' });

  await fake.getByRole('switch', { name: 'Use fake' }).click();
  await expect(fake.locator('.mcp-state')).toHaveText('off');
  expect((await mcpFile()).mcpServers['fake']?.['disabled']).toBe(true);

  await hub.getByLabel('Name').fill('second');
  await hub.getByLabel('Command or URL').fill(`"${process.execPath}" "${FAKE_MCP}"`);
  await hub.getByRole('button', { name: 'Add' }).click();
  const second = hub.locator('.mcp-row', { hasText: 'second' });
  await expect(second.locator('.mcp-state')).toHaveText(/connected · \d+ tools/, { timeout: 15_000 });
  expect((await mcpFile()).mcpServers['second']).toEqual({ command: process.execPath, args: [FAKE_MCP] });

  // A name already taken is refused, in words.
  await hub.getByLabel('Name').fill('second');
  await hub.getByLabel('Command or URL').fill('node x.js');
  await hub.getByRole('button', { name: 'Add' }).click();
  await expect(hub.locator('.mcp-add-error')).toHaveText('A server already has this name.');

  await second.getByRole('button', { name: 'Remove' }).click();
  await second.getByRole('button', { name: 'Remove it?' }).click();
  await expect(second).toHaveCount(0);
  expect((await mcpFile()).mcpServers['second']).toBeUndefined();
  expect((await mcpFile()).mcpServers['fake']).toBeDefined();
});
