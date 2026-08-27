import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Les tests E2E lancent Electron : ils ont leur propre lanceur
    // (playwright.config.ts) et n'ont rien à faire dans la suite unitaire.
    exclude: ['**/node_modules/**', '**/out/**', 'e2e/**'],
    /*
     * Vitest vide les imports CSS par défaut — y compris ceux en `?raw`, qui
     * rendent alors la chaîne VIDE au lieu de la feuille. Un test qui compare
     * des feuilles passerait donc à vide, ce qui est le pire des deux mondes :
     * vert et aveugle. On les laisse traverser (cf. aparte-tokens.spec.ts, qui
     * ancre les deux feuilles avant de les comparer).
     */
    css: true,
  },
});
