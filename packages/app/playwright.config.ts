import { defineConfig } from '@playwright/test';

/**
 * E2E Electron, délibérément hors du `pnpm test` du dépôt : ces tests lancent
 * l'application, donc ils demandent un écran et du temps. La suite unitaire
 * doit rester exécutable partout, en quelques secondes.
 */
export default defineConfig({
  testDir: './e2e',
  // Une seule instance d'Electron à la fois : les tests partagent la fenêtre.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: [['list']],
});
