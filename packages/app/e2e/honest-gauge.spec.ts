/**
 * The honest gauge (P2.8): a turn says how fast its reply came, and a
 * resumed conversation says what the restore saved — the time it took,
 * and what computing its tokens again would have cost, from the prefill
 * speed this machine measured.
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
  // 2 ms per uncached prompt token: the machine "prefills" 500 tokens a
  // second; the prefill reports every 48 tokens, and takes real time to.
  server = await startFakeLlamaServer({
    msPerToken: 2,
    prefillBatch: 48,
    prefillPaceMs: 250,
    responder: () => 'a short answer',
  });
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-gauge-'));
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
  const store = new ConversationStore(join(dataDir, 'conversations'));
  await store.create('conv-a', { title: 'Alpha' });
  await store.create('conv-b', { title: 'Bravo' });
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

test('a turn shows its speed; resumed, a conversation says what its restore saved', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  const strip = window.locator('.status-strip');
  const chip = (text: string | RegExp) => strip.locator('.status-chip', { hasText: text });
  const editor = window.locator('.aparte-ci-editor');
  const send = async (text: string) => {
    await editor.fill(text);
    await editor.press('Enter');
  };
  // Nothing loaded at startup: said as such.
  await expect(chip('engine not connected')).toBeVisible();

  await send(`please read this ${'long '.repeat(120)}message`);
  // The prompt being read, live — then, once its speed is known, the time left.
  const reading = strip.locator('.prefill-chip');
  await expect(reading).toContainText(/reading [\d,]+ \/ [\d,]+ tokens/, { timeout: 10_000 });
  await expect(reading).toContainText(/~\d+ m?s left/);
  await expect(strip).toContainText(/\d+ tok\/s/, { timeout: 10_000 });
  await expect(reading).toHaveCount(0);
  await expect(chip('engine not connected')).toHaveCount(0);

  // Bravo takes the slot; Alpha waits on disk, and the strip says it resumes on send.
  await window.locator('.conv-item', { hasText: 'Bravo' }).click();
  await expect(chip('resumes on send')).toBeVisible();
  await send('hello bravo');
  await expect(chip('resumes on send')).toHaveCount(0, { timeout: 10_000 });
  await window.locator('.conv-item', { hasText: 'please read this' }).click();
  await expect(chip('resumes on send')).toBeVisible();

  await send('and back to alpha');
  const restored = chip('context restored');
  await expect(restored).toBeVisible({ timeout: 10_000 });
  await expect(restored).toContainText(/context restored · \d+ tokens in \d+(\.\d)? m?s — instead of ~\d+(\.\d)? m?s/);
});
