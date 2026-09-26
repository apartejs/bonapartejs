/**
 * bonaparte's palette is React's — the tokens of react.dev — not apartéJS's
 * brass. The chat components read `--aparte-*`, so the palette is declared
 * on those tokens, for both themes. This proves the declaration reaches the
 * DOM (source order, specificity) — which reading a stylesheet cannot.
 */

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;

test.beforeAll(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-theme-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({ backend: { mode: 'managed', binPath: 'llama' }, locale: 'en' }),
  );

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

function token(window: Page, name: string): Promise<string> {
  return window.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(),
    name,
  );
}

function setTheme(window: Page, theme: 'light' | 'dark'): Promise<void> {
  return window.evaluate((t) => {
    document.documentElement.setAttribute('data-aparte-theme', t);
    document.documentElement.style.colorScheme = t;
  }, theme);
}

/** The painted background of a kit primary button — the token seen through a real control. */
function primaryButtonBackground(window: Page): Promise<string> {
  return window.evaluate(() => {
    const probe = document.createElement('button');
    probe.className = 'aparte-btn aparte-btn--primary aparte-btn--solid';
    probe.textContent = 'probe';
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
}

test('the palette is React blue on react.dev greys, in both themes', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();

  await setTheme(window, 'light');
  expect(await token(window, '--aparte-primary')).toBe('#087ea4');
  expect(await token(window, '--aparte-bg')).toBe('#f6f7f9');
  expect(await token(window, '--aparte-text')).toBe('#23272f');
  // The user bubble is a literal in the kit, not derived from the accent: a
  // rebrand that forgets it keeps a plum bubble on a blue page.
  expect(await token(window, '--aparte-message-content-bg-user')).toBe('#e6f7ff');
  expect(await primaryButtonBackground(window)).toBe('rgb(8, 126, 164)');

  await setTheme(window, 'dark');
  expect(await token(window, '--aparte-primary')).toBe('#58c4dc');
  expect(await token(window, '--aparte-bg')).toBe('#16181d');
  expect(await token(window, '--aparte-text')).toBe('#f6f7f9');
  expect(await primaryButtonBackground(window)).toBe('rgb(88, 196, 220)');
});

test('an OS in dark mode does not bring the kit palette back', async () => {
  // Since apartéJS 0.16.7 the kit also answers `prefers-color-scheme: dark`,
  // under `:root:not([data-aparte-theme=light])` — a selector that outranks
  // a bare `[data-aparte-theme="dark"]`. On a dark Windows that turned the
  // chat back to brass and plum while the shell stayed blue.
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  await window.emulateMedia({ colorScheme: 'dark' });
  try {
    await setTheme(window, 'dark');
    expect(await token(window, '--aparte-primary')).toBe('#58c4dc');
    expect(await token(window, '--aparte-bg')).toBe('#16181d');
    expect(await token(window, '--aparte-text')).toBe('#f6f7f9');
    expect(await primaryButtonBackground(window)).toBe('rgb(88, 196, 220)');

    await setTheme(window, 'light');
    expect(await token(window, '--aparte-primary')).toBe('#087ea4');
    expect(await token(window, '--aparte-bg')).toBe('#f6f7f9');
  } finally {
    await window.emulateMedia({ colorScheme: 'light' });
  }
});
