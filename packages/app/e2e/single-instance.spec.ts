/**
 * One bonaparte per data directory. A second launch — a double click on the
 * shortcut, `npx @aparte/bonaparte` typed twice — must not start a second
 * process fighting the first for the server's port and the same
 * conversations on disk: it hands over to the running one and leaves.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let env: Record<string, string>;
const mainEntry = join(import.meta.dirname, '..', 'out', 'main', 'index.js');

test.beforeAll(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-single-'));
  env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || value === undefined) continue;
    env[key] = value;
  }
  env['BONAPARTE_DATA_DIR'] = dataDir;
  env['BONAPARTE_E2E'] = '1';
  app = await electron.launch({ args: [mainEntry], env });
  await (await app.firstWindow()).locator('.app-shell').waitFor();
});

test.afterAll(async () => {
  await app?.close();
});

test('a second launch hands over to the running app and exits', async () => {
  const electronPath = createRequire(import.meta.url)('electron') as unknown as string;
  const second = spawn(electronPath, [mainEntry], { env, stdio: 'ignore' });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      second.kill();
      reject(new Error('the second instance kept running'));
    }, 20_000);
    second.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  expect(exitCode).toBe(0);

  // The running app was told, and is still there.
  const told = await app.evaluate(
    () => (globalThis as { __bonaparteSecondInstances?: number }).__bonaparteSecondInstances ?? 0,
  );
  expect(told).toBe(1);
  await expect((await app.firstWindow()).locator('.app-shell')).toBeVisible();
});
