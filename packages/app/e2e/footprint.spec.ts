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
 * Plafond au repos. Mesure du 2026-08-19 sur Windows 11 : 343 Mo répartis sur
 * quatre processus (principal 96, GPU 60, utilitaire 44, rendu 143). La marge
 * absorbe les variations de plateforme ; un dépassement franc veut dire qu'on
 * a embarqué quelque chose sans s'en rendre compte, et mérite d'être regardé.
 */
const BUDGET_MO = 450;

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
    mo: Math.round((m.memory.workingSetSize ?? 0) / 1024),
  }));
  const total = parProcessus.reduce((sum, p) => sum + p.mo, 0);

  // Le chiffre est imprimé même quand le test passe : c'est la donnée qu'on
  // revendique, elle ne doit pas être visible seulement en cas d'échec.
  console.log(
    `empreinte : ${total} Mo — ${parProcessus.map((p) => `${p.type} ${p.mo}`).join(', ')}`,
  );

  expect(total, `empreinte de ${total} Mo, budget ${BUDGET_MO} Mo`).toBeLessThan(
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
