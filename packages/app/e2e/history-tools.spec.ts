/**
 * A conversation reads back the way it was seen: the tool calls of earlier
 * turns, their outcome, the reasoning — not the text alone.
 *
 * Reported by Paul on 2026-08-28: after a reload the earlier tool calls had
 * vanished from the thread.
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;

test.beforeAll(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-history-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({
      backend: { mode: 'managed', binPath: 'llama' },
      currentConversationId: 'conv-a',
      locale: 'en',
    }),
  );
  const store = new ConversationStore(join(dataDir, 'conversations'));
  await store.create('conv-a', { title: 'Alpha' });
  const at = new Date().toISOString();
  await store.appendEvent('conv-a', { type: 'user', text: 'What is in the config?', at });
  await store.appendEvent('conv-a', {
    type: 'assistant',
    entry: {
      role: 'assistant',
      text: '',
      thinking: 'Let me read the file before answering.',
      reasoning: true,
      calls: [{ name: 'read_file', arguments: { path: 'config.json' } }],
    },
    at,
  });
  await store.appendEvent('conv-a', {
    type: 'tool_results',
    entry: {
      role: 'tool_results',
      results: [{ name: 'read_file', ok: true, content: '{ "retries": 3 }' }],
    },
    at,
  });
  await store.appendEvent('conv-a', {
    type: 'assistant',
    entry: { role: 'assistant', text: 'It sets retries to 3.', reasoning: true },
    at,
  });

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
});

test('an earlier turn shows its tool call, settled, and its reply', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  const thread = window.locator('.chat-wrap');

  await expect(thread).toContainText('What is in the config?');
  await expect(thread).toContainText('It sets retries to 3.');
  // The tool chip is there, named, and settled — not spinning for ever.
  const chip = thread.locator('.aparte-segment-tool-call');
  await expect(chip).toHaveCount(1);
  await expect(chip).toContainText('read_file');
  await expect(chip).toHaveAttribute('data-status', 'resolved');
  await expect(chip.locator('.aparte-tool-spinner')).toBeHidden();
  // The reasoning is there too, collapsed.
  await expect(thread.locator('.aparte-segment-thinking')).toHaveCount(1);
});
