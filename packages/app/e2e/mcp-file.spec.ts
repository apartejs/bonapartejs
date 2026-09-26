/**
 * `mcp-servers.json` is edited by hand, often on Windows: a BOM from
 * Notepad or PowerShell must read as written, and a file that does not
 * parse must never be taken for an empty one — the hub says so, and adding
 * a server does not write over it (it may hold every server's API keys).
 * From the adversarial review of 2026-09-26.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let dataDir: string;
const file = () => join(dataDir, 'config', 'mcp-servers.json');

test.beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-mcp-file-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({ backend: { mode: 'managed', binPath: 'llama' }, locale: 'en' }),
  );
  // Saved by an editor that writes a BOM.
  await writeFile(
    file(),
    `﻿${JSON.stringify({ mcpServers: { keep: { command: 'my-server', env: { API_KEY: 'sk-secret' }, disabled: true } } })}`,
    'utf8',
  );
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

test('a BOM reads as written; an unparsable file is said, and never written over', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  await window.getByRole('button', { name: 'Settings' }).click();
  const hub = window.locator('.settings-hub');
  await hub.getByRole('button', { name: 'MCP servers' }).click();
  await expect(hub.locator('.mcp-row', { hasText: 'keep' }).locator('.mcp-state')).toHaveText('off');

  // A trailing comma, as a hand edit leaves it.
  const broken = '{ "mcpServers": { "keep": { "command": "my-server", "env": { "API_KEY": "sk-secret" } }, } }';
  await writeFile(file(), broken, 'utf8');
  await hub.getByRole('button', { name: 'Read the file again' }).click();
  await expect(hub.locator('.mcp-file-unreadable')).toContainText('cannot be read');

  await hub.getByLabel('Name').fill('second');
  await hub.getByLabel('Command or URL').fill('node x.js');
  await hub.getByRole('button', { name: 'Add' }).click();
  await expect(hub.locator('.mcp-add-error')).toContainText('nothing was added');
  expect(await readFile(file(), 'utf8')).toBe(broken);

  // Fixed by hand, read again: back to normal.
  await writeFile(file(), JSON.stringify({ mcpServers: { keep: { command: 'my-server', disabled: true } } }), 'utf8');
  await hub.getByRole('button', { name: 'Read the file again' }).click();
  await expect(hub.locator('.mcp-file-unreadable')).toHaveCount(0);
  await expect(hub.locator('.mcp-row', { hasText: 'keep' })).toBeVisible();
});
