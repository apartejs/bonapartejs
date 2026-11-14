import { defineConfig } from '@playwright/test';

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
