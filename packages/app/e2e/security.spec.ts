/**
 * The main window is the app and nothing else (security audit 07, §1).
 *
 * It carries the preload — the whole bridge to the harness — so it must
 * never navigate away: a link in a reply, a script that got in, a redirect
 * would hand that bridge to a foreign page. External links open in the
 * system browser instead, http(s) only. And the packaged renderer runs
 * under a Content-Security-Policy: no inline script, no eval.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;

test.beforeAll(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-security-'));
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

const openedLinks = (): Promise<string[]> =>
  app.evaluate(() => (globalThis as { __bonaparteOpenedLinks?: string[] }).__bonaparteOpenedLinks ?? []);

test('the window never navigates away from the app', async () => {
  const window = await app.firstWindow();
  await window.locator('.app-shell').waitFor();
  const before = window.url();

  await window.evaluate(() => {
    window.location.href = 'https://example.com/';
  });
  await window.waitForTimeout(500);

  expect(window.url()).toBe(before);
  // Read the DOM directly: Playwright keeps a refused navigation "pending".
  expect(await window.evaluate(() => document.querySelector('.app-shell') !== null)).toBe(true);
});

test('a link that opens a window goes to the system browser — http(s) only', async () => {
  const window = await app.firstWindow();
  const opened = await window.evaluate(() => {
    const a = window.open('https://example.com/docs');
    const b = window.open('file:///C:/Windows/win.ini');
    return [a === null, b === null];
  });

  expect(opened).toEqual([true, true]);
  expect(await openedLinks()).toEqual(['https://example.com/docs']);
  expect(app.windows()).toHaveLength(1);
});

test('the renderer runs under a CSP: no inline script, no inline handler, no eval', async () => {
  const window = await app.firstWindow();
  const verdict = await window.evaluate(async () => {
    const violations: string[] = [];
    document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective));
    const script = document.createElement('script');
    script.textContent = 'window.__inlineRan = true;';
    document.head.append(script);
    const button = document.createElement('button');
    button.setAttribute('onclick', 'window.__handlerRan = true;');
    document.body.append(button);
    button.click();
    button.remove();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const policy =
      document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '';
    const scope = window as { __inlineRan?: boolean; __handlerRan?: boolean };
    return {
      inlineRan: scope.__inlineRan === true,
      handlerRan: scope.__handlerRan === true,
      violations: violations.length,
      // Code run by the test harness is exempt from the eval check: the
      // policy itself says eval is not allowed.
      allowsEval: policy.includes('unsafe-eval'),
      scriptSelfOnly: /script-src 'self'(;|$)/.test(policy),
    };
  });

  expect(verdict).toEqual({
    inlineRan: false,
    handlerRan: false,
    violations: 2,
    allowsEval: false,
    scriptSelfOnly: true,
  });
});

test('the theme is still set before the first paint (the boot script is not inline any more)', async () => {
  const window = await app.firstWindow();
  const theme = await window.evaluate(() => document.documentElement.getAttribute('data-aparte-theme'));
  expect(['light', 'dark']).toContain(theme);
});
