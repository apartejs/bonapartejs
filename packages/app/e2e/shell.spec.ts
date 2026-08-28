/**
 * Shell E2E — the only check that actually launches the application.
 *
 * It exists for a class of bugs nothing else catches: rendering. A unit test
 * doesn't see that a bubble shows "[Unknown segment type]" because a
 * registration is missing at startup; the launched app does.
 *
 * Outside of `pnpm test`: it starts Electron, so it needs a screen and a few
 * seconds. It runs via `pnpm --filter @aparte/bonaparte-app test:e2e`, after
 * a `pnpm build`.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;

test.beforeAll(async () => {
  // Disposable data directory: the test must never touch the user's real
  // conversations or config.
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-'));

  // `ELECTRON_RUN_AS_NODE` lingers in some development environments:
  // Electron then starts as a plain Node process and refuses the debug flag
  // Playwright passes it. We start from a clean environment rather than
  // depending on the machine's own.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || value === undefined) continue;
    env[key] = value;
  }
  env['BONAPARTE_DATA_DIR'] = dataDir;
  // The window stays hidden: running the suite must not make the app pop up
  // in front of whoever is running it.
  env['BONAPARTE_E2E'] = '1';

  app = await electron.launch({
    args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')],
    env,
  });
});

test.afterAll(async () => {
  await app?.close();
});

test('the shell mounts, status bar included', async () => {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // The skeleton is there: without it, nothing else makes sense.
  await expect(window.locator('.app-shell')).toBeVisible();
  // And the status bar, which must always say where things stand.
  await expect(window.locator('.status-strip')).toBeVisible();
});

test('the chat lib is mounted and no segment falls back to unknown', async () => {
  const window = await app.firstWindow();

  // aparté's web components are defined: the lib was indeed loaded by the
  // renderer. (Whether its segment renderers are registered is verified
  // separately, in aparte-bootstrap.spec.ts — here we can't import a bare
  // specifier into an already-bundled page.)
  const defined = await window.evaluate(() =>
    Boolean(customElements.get('aparte-chat-bubble')),
  );
  expect(defined).toBe(true);

  // Guard against the "[Unknown segment type: text]" bug: if a rendered
  // segment can't find its renderer, the lib leaves this class in the DOM.
  expect(await window.locator('.segment-unknown').count()).toBe(0);
});

test('the built-in plugins are discovered from the built entry', async () => {
  // `electron out/main/index.js` makes the app path the ENTRY's directory,
  // two levels below the package: the plugins were silently absent from
  // every E2E, and the tooling panel offered no view.
  const window = await app.firstWindow();
  const plugins = await window.evaluate(() => window.bonaparte.listPlugins());
  expect(plugins.map((plugin) => plugin.id).sort()).toEqual([
    'browser',
    'conversation-settings',
    'project-launcher',
    'terminal',
    'web-search',
  ]);
});

test('the status strip shows what the machine is doing', async () => {
  // CPU and RAM come from Node everywhere: the first sample arrives after
  // one interval, the CPU figure with the second.
  const window = await app.firstWindow();
  await expect(window.locator('.res-chip', { hasText: 'RAM' })).toBeVisible({ timeout: 12_000 });
  await expect(window.locator('.res-chip', { hasText: 'CPU' })).toBeVisible({ timeout: 12_000 });
});

test('no console error at startup', async () => {
  const window = await app.firstWindow();
  const errors: string[] = [];
  window.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await window.waitForTimeout(1_000);
  expect(errors).toEqual([]);
});
