/**
 * Switching a conversation to another model is announced with its cost
 * before it is paid (D-03, P1.7): the menu shows what each model will take
 * in memory, and the switch asks first — the model read from disk, the
 * conversation computed again, the memory it needs. Cancel changes nothing.
 *
 * The models are two synthetic GGUF files (a real header, no tensors) in a
 * folder named by BONAPARTE_MODEL_DIRS; the engine is the fake llama-server,
 * joined as a remote endpoint.
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { startFakeLlamaServer, type FakeLlamaServer } from '@aparte/bonaparte-core/testing';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let server: FakeLlamaServer;
let modelA: string;
let modelB: string;

/** A GGUF v3 header for a small dense model, padded to `sizeBytes`. */
function syntheticGguf(sizeBytes: number): Buffer {
  const u32 = (n: number): Buffer => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const u64 = (n: number): Buffer => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };
  const str = (s: string): Buffer => Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s)]);
  const entries: [string, Buffer][] = [
    ['general.architecture', Buffer.concat([u32(8), str('qwen3')])],
    ['qwen3.block_count', Buffer.concat([u32(4), u32(28)])],
    ['qwen3.context_length', Buffer.concat([u32(4), u32(40960)])],
    ['qwen3.embedding_length', Buffer.concat([u32(4), u32(2048)])],
    ['qwen3.attention.head_count', Buffer.concat([u32(4), u32(16)])],
    ['qwen3.attention.head_count_kv', Buffer.concat([u32(4), u32(8)])],
    ['qwen3.attention.key_length', Buffer.concat([u32(4), u32(128)])],
    ['qwen3.attention.value_length', Buffer.concat([u32(4), u32(128)])],
  ];
  const header = Buffer.concat([
    Buffer.from('GGUF'),
    u32(3),
    u64(0),
    u64(entries.length),
    ...entries.flatMap(([key, value]) => [str(key), value]),
  ]);
  return Buffer.concat([header, Buffer.alloc(Math.max(0, sizeBytes - header.length))]);
}

test.beforeAll(async () => {
  server = await startFakeLlamaServer({ responder: () => 'ok' });
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-switch-model-'));
  const models = join(dataDir, 'models');
  await mkdir(models, { recursive: true });
  modelA = join(models, 'alpha-model.gguf');
  modelB = join(models, 'bravo-model.gguf');
  await writeFile(modelA, syntheticGguf(3 * 1024 ** 2));
  await writeFile(modelB, syntheticGguf(5 * 1024 ** 2));

  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({
      backend: { mode: 'remote', url: server.url },
      currentConversationId: 'conv-a',
      locale: 'en',
    }),
  );
  const store = new ConversationStore(join(dataDir, 'conversations'));
  const at = new Date().toISOString();
  await store.create('conv-a', { title: 'Alpha', modelPath: modelA });
  await store.appendEvent('conv-a', { type: 'user', text: 'a question worth some tokens '.repeat(40), at });

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || value === undefined) continue;
    env[key] = value;
  }
  env['BONAPARTE_DATA_DIR'] = dataDir;
  env['BONAPARTE_MODEL_DIRS'] = models;
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

test('the model menu says what each model will take in memory', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  await window.locator('.model-button').click();

  const bravo = window.locator('.model-item', { hasText: 'bravo-model' });
  await expect(bravo).toBeVisible();
  // Weights (5 MiB) + context at the engine's size + margin: an estimate, marked as one.
  await expect(bravo.locator('.model-item-size')).toContainText('≈');
  await expect(bravo.locator('.model-item-size')).toHaveAttribute('title', /at \d[\d,  ]* tokens — model/);
  await window.keyboard.press('Escape');
});

test('switching a conversation with a history shows its cost first; Cancel changes nothing, Switch switches', async () => {
  const window = await app.firstWindow();
  await window.locator('.model-button').click();
  await window.locator('.model-item', { hasText: 'bravo-model' }).click();

  const dialog = window.getByRole('dialog');
  await expect(dialog).toContainText('Switch this conversation to bravo-model?');
  await expect(dialog).toContainText('read from disk');
  await expect(dialog).toContainText(/computed again: [\d,  ]+ tokens/);
  await expect(dialog).toContainText('of memory at');

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(window.locator('.model-button')).toContainText('alpha-model');

  await window.locator('.model-button').click();
  await window.locator('.model-item', { hasText: 'bravo-model' }).click();
  await window.getByRole('dialog').getByRole('button', { name: 'Switch' }).click();
  await expect(window.locator('.model-button')).toContainText('bravo-model', { timeout: 10_000 });
});
