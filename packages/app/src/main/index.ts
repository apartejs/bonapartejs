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

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
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
  win.once('ready-to-show', () => win.show());

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
