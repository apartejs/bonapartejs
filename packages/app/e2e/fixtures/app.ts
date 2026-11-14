/**
 * The one way an end-to-end test launches bonaparte. It starts a fake
 * llama-server, gives the app a data folder of its own (so that a test never
 * touches the person's real conversations), and launches the built app with
 * `BONAPARTE_E2E=1`: its window stays off the screen, transparent and never
 * activated, and an error goes to the console, never to a native box.
 *
 * A spec asks for the `launch` fixture; it closes what it launched, and says
 * what the app wrote to its console when the test failed.
 */

import { startFakeLlamaServer, type FakeLlamaServer, type FakeLlamaServerOptions } from '@aparte/bonaparte-core/testing';
import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { builtAppEntry } from './app-entry.js';
import { appEnvironment } from './app-env.js';

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
  /** The addresses the window has loaded, or failed to load, since it was launched: none, if it stayed on its page. */
  navigations(): Promise<string[]>;
  /** What the app wrote to its console, main process and window. */
  output(): string;
  close(): Promise<void>;
}

/** Closes the app, and makes sure of it: a test never leaves an Electron behind. */
async function closeApp(app: ElectronApplication): Promise<void> {
  const child = app.process();
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  await Promise.race([app.close().catch(() => undefined), delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await Promise.race([exited, delay(2_000)]);
}

export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  // Before anything is started: no build, no Electron.
  const entry = builtAppEntry(appRoot);
  const server = await startFakeLlamaServer(options.engine);
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-'));
  const lines: string[] = [];
  const output = (): string => lines.join('');
  let app: ElectronApplication | undefined;

  const close = async (): Promise<void> => {
    if (app) await closeApp(app);
    await server.close();
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  };

  try {
    await mkdir(join(dataDir, 'config'), { recursive: true });
    await writeFile(
      join(dataDir, 'config', 'global.json'),
      JSON.stringify({ backend: { mode: 'remote', url: server.url } }),
    );

    app = await electron.launch({
      args: [entry],
      cwd: appRoot,
      env: appEnvironment(process.env, { dataDir, locale: options.locale ?? 'fr', extra: options.env }),
      timeout: 30_000,
    });
    const child = app.process();
    child.stdout?.on('data', (chunk: Buffer) => lines.push(`[main] ${chunk.toString()}`));
    child.stderr?.on('data', (chunk: Buffer) => lines.push(`[main] ${chunk.toString()}`));

    const watched = new WeakSet<Page>();
    const watch = (page: Page): void => {
      if (watched.has(page)) return;
      watched.add(page);
      page.on('console', (message) => lines.push(`[window:${message.type()}] ${message.text()}\n`));
      page.on('pageerror', (error) => lines.push(`[window:error] ${error.message}\n`));
    };
    app.on('window', watch);

    const page = await app.firstWindow({ timeout: 30_000 });
    watch(page);
    await page.waitForLoadState('domcontentloaded');

    // From here on, every document the window loads, or fails to load, is
    // recorded in the main process: a test can say "it went nowhere" without
    // waiting for an address to change. (Not `did-start-navigation`: that one
    // fires for a navigation the app is about to refuse, too.)
    const running = app;
    await running.evaluate(({ BrowserWindow }) => {
      const record = globalThis as { __navigations?: string[] };
      record.__navigations = [];
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.on('did-navigate', (_event, url) => record.__navigations?.push(url));
        window.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
          // -3 is a navigation that was cancelled: one the app refused.
          if (isMainFrame && code !== -3) record.__navigations?.push(url);
        });
      }
    });
    const navigations = (): Promise<string[]> =>
      running.evaluate(() => (globalThis as { __navigations?: string[] }).__navigations ?? []);

    return { app, page, server, dataDir, navigations, output, close };
  } catch (error) {
    await close();
    throw new Error(`The app did not start.\n${output()}`, { cause: error });
  }
}

export const test = base.extend<{ launch: (options?: LaunchOptions) => Promise<LaunchedApp> }>({
  // Playwright reads the fixtures a fixture needs from this pattern: none here.
  launch: async ({}, use, testInfo) => {
    const launched: LaunchedApp[] = [];
    await use(async (options) => {
      const one = await launchApp(options);
      launched.push(one);
      return one;
    });
    for (const one of launched) {
      if (testInfo.status !== testInfo.expectedStatus) {
        // What the app said, and what its window showed: read them before guessing.
        console.error(`--- what the app wrote ---\n${one.output().slice(-6_000)}`);
        await testInfo.attach('app-output.txt', { body: one.output(), contentType: 'text/plain' });
        const picture = testInfo.outputPath('window.png');
        const taken = await one.page.screenshot({ path: picture, timeout: 5_000 }).then(
          () => true,
          () => false,
        );
        if (taken) await testInfo.attach('window.png', { path: picture, contentType: 'image/png' });
      }
      await one.close();
    }
  },
});

export { expect } from '@playwright/test';
