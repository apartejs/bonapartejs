/**
 * The interface's GPU (P3.1, D-23): off by default — every megabyte of VRAM
 * goes to the model — and a setting gives it back. Chromium fixes its GPU
 * mode at startup, so a change waits for a restart, and the hub says what
 * the restart costs before offering it.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function launch(settings: Record<string, unknown>): Promise<{ app: ElectronApplication; dataDir: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-gpu-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({ backend: { mode: 'managed', binPath: 'llama' }, locale: 'en', settings }),
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || value === undefined) continue;
    env[key] = value;
  }
  env['BONAPARTE_DATA_DIR'] = dataDir;
  env['BONAPARTE_E2E'] = '1';
  const app = await electron.launch({ args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')], env });
  return { app, dataDir };
}

test('off by default; asking for it announces the restart and its cost, then restarts on demand', async () => {
  const { app, dataDir } = await launch({});
  try {
    expect(await app.evaluate(({ app: electronApp }) => electronApp.isHardwareAccelerationEnabled())).toBe(false);
    const window = await app.firstWindow();
    await window.locator('.app-shell').waitFor();
    await window.getByRole('button', { name: 'Settings' }).click();
    const hub = window.locator('.settings-hub');
    await hub.getByRole('button', { name: 'Engine and model' }).click();
    const notice = hub.locator('.gpu-restart');
    await expect(hub.locator('#set-global-gpuAcceleration')).toBeVisible();
    await expect(notice).toBeHidden();

    await hub.locator('#set-global-gpuAcceleration').click();
    await window.getByRole('option', { name: 'On' }).click();
    await expect(notice).toContainText('Graphics acceleration changes when bonaparte restarts.');
    // No model loaded: the restart is free, and the notice says so.
    await expect(notice).toContainText('restarting costs nothing');
    const saved = JSON.parse(await readFile(join(dataDir, 'config', 'global.json'), 'utf8')) as {
      settings?: Record<string, unknown>;
    };
    expect(saved.settings?.['gpuAcceleration']).toBe('on');

    await notice.getByRole('button', { name: 'Restart now' }).click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as { __bonaparteRelaunches?: number }).__bonaparteRelaunches ?? 0))
      .toBe(1);

    // Back to what the process runs with: nothing left to restart for.
    await hub.locator('#set-global-gpuAcceleration').click();
    await window.getByRole('option', { name: 'Off (default)' }).click();
    await expect(notice).toBeHidden();
  } finally {
    await app.close();
  }
});

test('the saved choice is read at startup: on, the interface starts with the GPU', async () => {
  const { app } = await launch({ gpuAcceleration: 'on' });
  try {
    expect(await app.evaluate(({ app: electronApp }) => electronApp.isHardwareAccelerationEnabled())).toBe(true);
  } finally {
    await app.close();
  }
});
