import { join } from 'node:path';
import { BrowserWindow, Menu, app, ipcMain } from 'electron';
import { Harness } from './harness.js';

const harness = new Harness();

/**
 * Arrêt propre, exécuté une seule fois et ATTENDU par tous les chemins de
 * sortie. Sans cette garantie, Electron quitte pendant que la sauvegarde KV
 * et l'arrêt du serveur sont encore en vol — et le modèle survit à l'app.
 */
let shutdownPromise: Promise<void> | null = null;
let shutdownDone = false;

function shutdownOnce(): Promise<void> {
  shutdownPromise ??= harness
    .shutdown()
    .catch((error) => console.error('[shutdown]', error))
    .finally(() => {
      shutdownDone = true;
    });
  return shutdownPromise;
}

/**
 * Icône de l'application : la mascotte `('.')` d'aparté, la même que le favicon
 * d'apartejs.dev et de monaparte — une seule marque pour toute la famille.
 *
 * Empaquetée, elle vivra dans les ressources ; en développement, elle est à la
 * racine du paquet app. L'empaquetage (J5) n'existe pas encore, mais le chemin
 * est déjà là pour ne pas avoir à y repenser.
 */
function iconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(import.meta.dirname, '../../resources/icon.ico');
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    icon: iconPath(),
    // Fond posé avant tout paint pour éviter le flash blanc ; le renderer
    // applique ensuite le thème réel (attribut data-aparte-theme).
    backgroundColor: '#17141c',
    title: 'bonaparte',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM preload ⇒ sandbox désactivé (limitation Electron). Le renderer
      // n'accède à rien d'autre que l'API typée exposée par contextBridge.
      sandbox: false,
    },
  });

  harness.attachWindow(win);
  // Electron n'a pas de vrai mode headless : ce qu'on peut faire, c'est ne
  // JAMAIS montrer la fenêtre. Le renderer tourne quand même, le DOM est
  // vivant, et les tests observent exactement la même chose — sans qu'une
  // fenêtre surgisse devant l'utilisateur à chaque exécution.
  if (!process.env['BONAPARTE_E2E']) {
    win.once('ready-to-show', () => win.show());
  }

  // À la fermeture : sauvegarde de l'état KV et arrêt du serveur AVANT de
  // laisser la fenêtre partir.
  win.on('close', (event) => {
    if (shutdownDone) return;
    event.preventDefault();
    void shutdownOnce().finally(() => win.destroy());
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

// Un harnais pour modèles LOCAUX ne dépense pas de VRAM à composer des pixels.
// L'interface est du texte, des listes et des diffs : elle n'a rien à demander
// au GPU, alors que chaque mégaoctet de VRAM rendu au modèle est du contexte en
// plus. Doit être appelé AVANT `whenReady`.
app.disableHardwareAcceleration();

// Windows regroupe et illustre les fenêtres par cet identifiant : sans lui, la
// barre des tâches affiche l'icône d'Electron, quelle que soit celle de la
// fenêtre. Doit être posé avant la première fenêtre.
if (process.platform === 'win32') app.setAppUserModelId('dev.apartejs.bonaparte');

app.whenReady().then(async () => {
  // Pas de barre de menu : l'app porte sa propre navigation. Sur macOS on la
  // garde, le système y attache les raccourcis d'édition standard.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

  harness.registerIpc(ipcMain, app.getVersion());
  await harness.restoreSession();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Ceinture et bretelles : même si la fenêtre a sauté l'étape close (crash
// renderer, quit forcé), le serveur de modèle ne doit jamais survivre à l'app.
// On RETARDE la sortie le temps du nettoyage — un `void` ne suffisait pas :
// Electron quittait avant que le kill ne parte.
app.on('before-quit', (event) => {
  if (shutdownDone) return;
  event.preventDefault();
  void shutdownOnce().finally(() => app.quit());
});
