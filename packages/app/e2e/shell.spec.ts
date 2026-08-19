/**
 * E2E du shell — la seule vérification qui lance vraiment l'application.
 *
 * Elle existe pour une classe de bugs que rien d'autre n'attrape : le rendu.
 * Un test unitaire ne voit pas qu'une bulle affiche « [Unknown segment type] »
 * parce qu'un enregistrement manque au démarrage ; l'app lancée, si.
 *
 * Hors de `pnpm test` : elle démarre Electron, donc elle demande un écran et
 * quelques secondes. Elle se lance par `pnpm --filter @aparte/bonaparte-app
 * test:e2e`, après un `pnpm build`.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;

test.beforeAll(async () => {
  // Répertoire de données jetable : le test ne doit jamais toucher les
  // conversations ni la config réelles de l'utilisateur.
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-e2e-'));

  // `ELECTRON_RUN_AS_NODE` traîne dans certains environnements de
  // développement : Electron démarre alors comme un simple Node et refuse le
  // drapeau de débogage que Playwright lui passe. On part d'un environnement
  // propre plutôt que de dépendre de celui de la machine.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || value === undefined) continue;
    env[key] = value;
  }
  env['BONAPARTE_DATA_DIR'] = dataDir;

  app = await electron.launch({
    args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')],
    env,
  });
});

test.afterAll(async () => {
  await app?.close();
});

test('la fenêtre s’ouvre sur un écran utilisable', async () => {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // Le squelette est là : sans lui, rien d'autre n'a de sens.
  await expect(window.locator('.app-shell')).toBeVisible();
  // Et la barre de statut, qui doit toujours dire où on en est.
  await expect(window.locator('.status-strip')).toBeVisible();
});

test('la lib de chat est montée et aucun segment ne tombe en inconnu', async () => {
  const window = await app.firstWindow();

  // Les web components d'aparté sont définis : la lib a bien été chargée par
  // le renderer. (Que ses renderers de segments soient enregistrés est
  // vérifié à part, dans aparte-bootstrap.spec.ts — ici on ne peut pas
  // importer un spécifieur nu dans une page déjà bundlée.)
  const defined = await window.evaluate(() =>
    Boolean(customElements.get('aparte-chat-bubble')),
  );
  expect(defined).toBe(true);

  // Garde-fou du bug « [Unknown segment type: text] » : si un segment rendu
  // ne trouve pas son renderer, la lib laisse cette classe dans le DOM.
  expect(await window.locator('.segment-unknown').count()).toBe(0);
});

test('aucune erreur de console au démarrage', async () => {
  const window = await app.firstWindow();
  const errors: string[] = [];
  window.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await window.waitForTimeout(1_000);
  expect(errors).toEqual([]);
});
