/**
 * The saved contexts' disk space, said and taken back (P2.2): the hub shows
 * what they take against their budget, and frees it on request — they are
 * a cache, the conversations are computed again on resume.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let dataDir: string;

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

test.beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-kv-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({ backend: { mode: 'managed', binPath: 'llama' }, locale: 'en' }),
  );
  const slots = join(dataDir, 'kv-slots');
  await mkdir(slots, { recursive: true });
  for (const id of ['conv-x', 'conv-y']) {
    await writeFile(join(slots, `${id}.slot`), Buffer.alloc(1536 * 1024));
    await writeFile(join(slots, `${id}.manifest.json`), '{}');
  }

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

test('the hub says what the saved contexts take, and frees the space', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  await window.locator('.status-strip').getByRole('button', { name: /settings/i }).click();

  const usage = window.locator('.kv-usage');
  await expect(usage).toContainText('Saved contexts take 3 MiB of 16.0 GiB — 2 conversations, 0 shared prefixes.');

  await usage.getByRole('button', { name: 'Free this space' }).click();

  await expect(usage.locator('.kv-freed')).toContainText('2 saved contexts dropped');
  await expect(usage).toContainText('take 0 MiB of 16.0 GiB — 0 conversations');
  expect(await exists(join(dataDir, 'kv-slots', 'conv-x.slot'))).toBe(false);
  expect(await exists(join(dataDir, 'kv-slots', 'conv-y.manifest.json'))).toBe(false);
});
