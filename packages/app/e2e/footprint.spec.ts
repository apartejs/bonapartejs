/**
 * Budget d'empreinte — la seule façon de tenir une promesse d'optimisation.
 *
 * bonaparte est un harnais pour modèles LOCAUX : il partage la machine avec
 * 20 Go de poids et plusieurs gigaoctets de cache KV. Annoncer « on est
 * léger » sans le mesurer ne vaut rien ; un budget qu'aucun test n'applique
 * est un vœu. Ce test échoue si l'app grossit, et le chiffre qu'il affiche
 * est celui qu'on a le droit de revendiquer.
 *
 * Mesuré au repos, fenêtre ouverte, sans conversation : c'est le plancher,
 * pas le pire cas.
 */

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Plafond au repos, en mémoire PRIVÉE.
 *
 * `workingSetSize` a d'abord servi ici — c'était une erreur, démontrée : le
 * MÊME commit mesurait 341 Mo un soir et 463 Mo une heure plus tard. Le
 * working set inclut les pages partagées et suit le rognage de l'OS selon la
 * pression mémoire de la machine ; il varie de ±35 % sans qu'une ligne de code
 * ait bougé. Un test qui échoue pour des raisons étrangères au code est pire
 * qu'aucun test : on finit par l'ignorer.
 *
 * `privateBytes` est la mémoire que le processus possède réellement. Mesure du
 * 2026-08-20 : ~200 Mo sur quatre processus.
 *
 * Réserve de portabilité : `privateBytes` est renseigné sur Windows ; ailleurs
 * il peut valoir 0, et on retombe alors sur le working set faute de mieux.
 */
const BUDGET_MO = 320;

let app: ElectronApplication;

test.beforeAll(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-footprint-'));
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
  await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
});

test('l’app tient dans son budget mémoire', async () => {
  // Mesurer dès l'ouverture de la fenêtre donne un chiffre flatteur (~275 Mo)
  // : le rendu n'a pas fini de s'installer. Ce n'est pas une condition qu'on
  // peut sonder, juste une stabilisation — on laisse deux secondes, et on
  // annonce le chiffre stable plutôt que le plus joli.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics());

  const parProcessus = metrics.map((m) => ({
    type: m.type,
    // privateBytes quand la plateforme le renseigne ; sinon le working set,
    // faute de mieux — mais alors le chiffre est bruité, cf. l'en-tête.
    mo: Math.round((m.memory.privateBytes || m.memory.workingSetSize || 0) / 1024),
  }));
  const total = parProcessus.reduce((sum, p) => sum + p.mo, 0);

  // Le chiffre est imprimé même quand le test passe : c'est la donnée qu'on
  // revendique, elle ne doit pas être visible seulement en cas d'échec.
  console.log(
    `empreinte privée : ${total} Mo — ${parProcessus.map((p) => `${p.type} ${p.mo}`).join(', ')}`,
  );

  expect(total, `empreinte privée de ${total} Mo, budget ${BUDGET_MO} Mo`).toBeLessThan(
    BUDGET_MO,
  );
});

test('aucune VRAM n’est dépensée à composer l’interface', async () => {
  // `disableHardwareAcceleration()` (main/index.ts) : notre interface est du
  // texte et des diffs, et chaque mégaoctet de VRAM rendu au modèle est du
  // contexte en plus.
  //
  // Mesuré le 2026-08-20 sur Windows (compteurs WDDM, fenêtre VISIBLE — une
  // fenêtre masquée n'est pas composée et rend un zéro qui ne prouve rien) :
  // même build, accélération active 31,7 Mo de VRAM dédiée, coupée 0 Mo. Côté
  // RAM, le processus GPU passe de 120 à 60 Mo.
  //
  // Ce test vérifie la CAUSE, pas l'effet : la VRAM se mesure depuis le
  // système (voir la spec), pas depuis Electron — mais l'état de
  // l'accélération, lui, est lisible ici. Si quelqu'un rallume le GPU sans
  // l'avoir décidé, il le saura par ce test.
  const accelerationDisabled = await app.evaluate(({ app: a }) =>
    a.commandLine.hasSwitch('disable-gpu-compositing') ||
    a.getGPUFeatureStatus()['gpu_compositing'] !== 'enabled',
  );

  expect(accelerationDisabled).toBe(true);
});
