import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { defineConfig } from '@playwright/test';

// The tests' temporary folder under its real name, for the workers and the app they launch: GitHub's Windows
// runner spells it with an 8.3 short name (`C:\Users\RUNNER~1\…`) that git gives long, and a test repository's
// worktree and changes were looked for at the other spelling (archive.spec, branches.spec; CI of 2026-11-21).
if (process.platform === 'win32') {
  const real = realpathSync.native(tmpdir());
  process.env['TEMP'] = real;
  process.env['TMP'] = real;
}

/**
 * End-to-end tests drive the built app (`pnpm build` first) against the fake
 * llama-server. One worker: each test launches its own Electron.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
