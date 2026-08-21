# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: footprint.spec.ts >> l’app tient dans son budget mémoire
- Location: e2e\footprint.spec.ts:55:1

# Error details

```
Error: empreinte de 461 Mo, budget 450 Mo

expect(received).toBeLessThan(expected)

Expected: < 450
Received:   461
```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - main [ref=f1e5]:
    - generic [ref=f1e7]:
      - paragraph [ref=f1e8]: premier lever de rideau
      - heading "Brancher le moteur" [level=1] [ref=f1e9]
      - paragraph [ref=f1e10]: "bonaparte pilote un llama-server : lancez-en un ici même (managé) ou pointez vers un hôte existant. Le modèle se choisit ensuite, conversation par conversation."
      - tablist [ref=f1e11]:
        - tab "bonaparte s’en occupe" [selected] [ref=f1e12] [cursor=pointer]
        - tab "J’ai déjà un serveur" [ref=f1e13] [cursor=pointer]
      - paragraph [ref=f1e14]: "bonaparte lance et surveille llama.cpp pour vous. C’est le seul mode qui garde le contexte d’une conversation à l’autre : la reprise est immédiate au lieu de tout recalculer."
      - generic [ref=f1e15]:
        - generic [ref=f1e16]:
          - text: Binaire llama (ou llama-server)
          - emphasis [ref=f1e17]: — détecté sur cette machine
        - generic [ref=f1e18]:
          - textbox "Binaire llama (ou llama-server) — détecté sur cette machine Parcourir…" [ref=f1e19]:
            - /placeholder: C:\outils\llama\llama.exe
            - text: C:\Users\paul\AppData\Local\Microsoft\WindowsApps\llama.exe
          - button "Parcourir…" [ref=f1e20] [cursor=pointer]
      - button "Lever le rideau" [ref=f1e21] [cursor=pointer]
  - contentinfo [ref=f1e22]:
    - generic [ref=f1e23]:
      - generic [ref=f1e24]: (-.-)
      - generic [ref=f1e26]: arrêté
    - button "Réglages" [ref=f1e28] [cursor=pointer]
```

# Test source

```ts
  1   | /**
  2   |  * Budget d'empreinte — la seule façon de tenir une promesse d'optimisation.
  3   |  *
  4   |  * bonaparte est un harnais pour modèles LOCAUX : il partage la machine avec
  5   |  * 20 Go de poids et plusieurs gigaoctets de cache KV. Annoncer « on est
  6   |  * léger » sans le mesurer ne vaut rien ; un budget qu'aucun test n'applique
  7   |  * est un vœu. Ce test échoue si l'app grossit, et le chiffre qu'il affiche
  8   |  * est celui qu'on a le droit de revendiquer.
  9   |  *
  10  |  * Mesuré au repos, fenêtre ouverte, sans conversation : c'est le plancher,
  11  |  * pas le pire cas.
  12  |  */
  13  | 
  14  | import {
  15  |   _electron as electron,
  16  |   expect,
  17  |   test,
  18  |   type ElectronApplication,
  19  | } from '@playwright/test';
  20  | import { mkdtemp } from 'node:fs/promises';
  21  | import { tmpdir } from 'node:os';
  22  | import { join } from 'node:path';
  23  | 
  24  | /**
  25  |  * Plafond au repos. Mesure du 2026-08-19 sur Windows 11 : 343 Mo répartis sur
  26  |  * quatre processus (principal 96, GPU 60, utilitaire 44, rendu 143). La marge
  27  |  * absorbe les variations de plateforme ; un dépassement franc veut dire qu'on
  28  |  * a embarqué quelque chose sans s'en rendre compte, et mérite d'être regardé.
  29  |  */
  30  | const BUDGET_MO = 450;
  31  | 
  32  | let app: ElectronApplication;
  33  | 
  34  | test.beforeAll(async () => {
  35  |   const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-footprint-'));
  36  |   const env: Record<string, string> = {};
  37  |   for (const [key, value] of Object.entries(process.env)) {
  38  |     if (key === 'ELECTRON_RUN_AS_NODE' || value === undefined) continue;
  39  |     env[key] = value;
  40  |   }
  41  |   env['BONAPARTE_DATA_DIR'] = dataDir;
  42  |   env['BONAPARTE_E2E'] = '1';
  43  | 
  44  |   app = await electron.launch({
  45  |     args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')],
  46  |     env,
  47  |   });
  48  |   await app.firstWindow();
  49  | });
  50  | 
  51  | test.afterAll(async () => {
  52  |   await app?.close();
  53  | });
  54  | 
  55  | test('l’app tient dans son budget mémoire', async () => {
  56  |   // Mesurer dès l'ouverture de la fenêtre donne un chiffre flatteur (~275 Mo)
  57  |   // : le rendu n'a pas fini de s'installer. Ce n'est pas une condition qu'on
  58  |   // peut sonder, juste une stabilisation — on laisse deux secondes, et on
  59  |   // annonce le chiffre stable plutôt que le plus joli.
  60  |   await new Promise((resolve) => setTimeout(resolve, 2000));
  61  | 
  62  |   const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics());
  63  | 
  64  |   const parProcessus = metrics.map((m) => ({
  65  |     type: m.type,
  66  |     mo: Math.round((m.memory.workingSetSize ?? 0) / 1024),
  67  |   }));
  68  |   const total = parProcessus.reduce((sum, p) => sum + p.mo, 0);
  69  | 
  70  |   // Le chiffre est imprimé même quand le test passe : c'est la donnée qu'on
  71  |   // revendique, elle ne doit pas être visible seulement en cas d'échec.
  72  |   console.log(
  73  |     `empreinte : ${total} Mo — ${parProcessus.map((p) => `${p.type} ${p.mo}`).join(', ')}`,
  74  |   );
  75  | 
> 76  |   expect(total, `empreinte de ${total} Mo, budget ${BUDGET_MO} Mo`).toBeLessThan(
      |                                                                     ^ Error: empreinte de 461 Mo, budget 450 Mo
  77  |     BUDGET_MO,
  78  |   );
  79  | });
  80  | 
  81  | test('aucune VRAM n’est dépensée à composer l’interface', async () => {
  82  |   // `disableHardwareAcceleration()` (main/index.ts) : notre interface est du
  83  |   // texte et des diffs, et chaque mégaoctet de VRAM rendu au modèle est du
  84  |   // contexte en plus.
  85  |   //
  86  |   // Mesuré le 2026-08-20 sur Windows (compteurs WDDM, fenêtre VISIBLE — une
  87  |   // fenêtre masquée n'est pas composée et rend un zéro qui ne prouve rien) :
  88  |   // même build, accélération active 31,7 Mo de VRAM dédiée, coupée 0 Mo. Côté
  89  |   // RAM, le processus GPU passe de 120 à 60 Mo.
  90  |   //
  91  |   // Ce test vérifie la CAUSE, pas l'effet : la VRAM se mesure depuis le
  92  |   // système (voir la spec), pas depuis Electron — mais l'état de
  93  |   // l'accélération, lui, est lisible ici. Si quelqu'un rallume le GPU sans
  94  |   // l'avoir décidé, il le saura par ce test.
  95  |   const accelerationDisabled = await app.evaluate(({ app: a }) =>
  96  |     a.commandLine.hasSwitch('disable-gpu-compositing') ||
  97  |     a.getGPUFeatureStatus()['gpu_compositing'] !== 'enabled',
  98  |   );
  99  | 
  100 |   expect(accelerationDisabled).toBe(true);
  101 | });
  102 | 
```