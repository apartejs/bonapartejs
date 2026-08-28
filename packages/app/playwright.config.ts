import { defineConfig } from '@playwright/test';

/**
 * Electron E2E, deliberately outside the repo's `pnpm test`: these tests
 * launch the application, so they need a screen and time. The unit suite
 * must stay runnable everywhere, in a few seconds.
 */
export default defineConfig({
  testDir: './e2e',
  // Only one Electron instance at a time: the tests share the window.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: [['list']],
});
