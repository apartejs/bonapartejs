import { join } from 'node:path';
import { BrowserWindow, app, ipcMain } from 'electron';
import { Harness } from './harness.js';

const harness = new Harness();
let quitting = false;

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

  // À la fermeture : sauvegarde de l'état KV avant de laisser partir.
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void harness
      .shutdown()
      .catch(() => undefined)
      .finally(() => win.destroy());
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
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
app.on('will-quit', () => {
  void harness.shutdown().catch(() => undefined);
});
