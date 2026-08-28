/**
 * Stop: the composer's button while a reply streams. It must cut the
 * generation — what arrived stays, the turn ends, the next message goes
 * through.
 *
 * Found by the feature audit of 2026-08-28: the library's Stop button was
 * wired to nothing, while the engine knew how to cancel.
 */

import { ConversationStore } from '@aparte/bonaparte-core';
import { startFakeLlamaServer, type FakeLlamaServer } from '@aparte/bonaparte-core/testing';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LONG =
  'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive twentysix twentyseven twentyeight twentynine thirty';

let app: ElectronApplication;
let server: FakeLlamaServer;

test.beforeAll(async () => {
  let turn = 0;
  server = await startFakeLlamaServer({
    paceMs: 150,
    responder: () => (turn++ === 0 ? LONG : 'after the stop'),
  });

  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-stop-'));
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

test('Stop cuts the reply where it stands, and the next message goes through', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  const thread = window.locator('.chat-wrap');
  const editor = window.locator('.aparte-ci-editor');

  // The prompt must not contain the reply's last word: the assertion reads the whole thread.
  await editor.fill('count for me');
  await editor.press('Enter');
  await expect(thread).toContainText('one two');

  // The send button is Stop while the reply streams. Forced: its icon
  // animates for as long as the reply streams, and Playwright's stability
  // check would otherwise wait for the very end of the reply to click.
  await window.locator('.aparte-send-button').click({ force: true });

  // Cut: the end never arrives, even after the time it would have taken.
  await window.waitForTimeout(3500);
  await expect(thread).not.toContainText('thirty');

  // And the conversation goes on.
  await editor.fill('still there?');
  await editor.press('Enter');
  await expect(thread).toContainText('after the stop', { timeout: 10_000 });
});
