import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // E2E tests launch Electron: they have their own runner
    // (playwright.config.ts) and have no business being in the unit suite.
    exclude: ['**/node_modules/**', '**/out/**', 'e2e/**'],
    /*
     * Vitest empties CSS imports by default — including `?raw` ones, which
     * then return an EMPTY string instead of the sheet. A test comparing
     * sheets would therefore pass vacuously, which is the worst of both
     * worlds: green and blind. We let them pass through (see
     * aparte-tokens.spec.ts, which anchors both sheets before comparing them).
     */
    css: true,
  },
});
