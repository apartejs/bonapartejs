/**
 * The one way an end-to-end test launches bonaparte. It starts a fake
 * llama-server, gives the app a data folder of its own (so that a test never
 * touches the person's real conversations), and launches the built app with
 * `BONAPARTE_E2E=1`, which keeps its window from ever coming to the foreground.
 */

import { startFakeLlamaServer, type FakeLlamaServer, type FakeLlamaServerOptions } from '@aparte/bonaparte-core/testing';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtAppEntry } from './app-entry.js';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface LaunchOptions {
  /** The fake engine: what it answers, how fast. */
  engine?: FakeLlamaServerOptions;
  /** The language of the interface (French by default, as on the design canvas). */
  locale?: 'fr' | 'en';
  /** Extra environment for the app. */
  env?: Record<string, string>;
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  server: FakeLlamaServer;
  dataDir: string;
  close(): Promise<void>;
}

export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  // Before anything is started: no build, no Electron.
  const entry = builtAppEntry(appRoot);
  const server = await startFakeLlamaServer(options.engine);
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({ backend: { mode: 'remote', url: server.url } }),
  );

  const app = await electron.launch({
    args: [entry],
    cwd: appRoot,
    env: {
      ...(process.env as Record<string, string>),
      BONAPARTE_DATA_DIR: dataDir,
      BONAPARTE_E2E: '1',
      BONAPARTE_LOCALE: options.locale ?? 'fr',
      // The machine's own engine must never leak into a test.
      BONAPARTE_LLAMA_URL: '',
      ...options.env,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  return {
    app,
    page,
    server,
    dataDir,
    async close() {
      await app.close().catch(() => undefined);
      await server.close();
      await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
