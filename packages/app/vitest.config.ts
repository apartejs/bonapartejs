import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Les tests E2E lancent Electron : ils ont leur propre lanceur
    // (playwright.config.ts) et n'ont rien à faire dans la suite unitaire.
    exclude: ['**/node_modules/**', '**/out/**', 'e2e/**'],
  },
});
