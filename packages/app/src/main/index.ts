import { join } from 'node:path';
import { IPC } from '@aparte/bonaparte-shared';
import { BrowserWindow, app, ipcMain } from 'electron';

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

  win.once('ready-to-show', () => win.show());

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle(IPC.appVersion, () => app.getVersion());

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
