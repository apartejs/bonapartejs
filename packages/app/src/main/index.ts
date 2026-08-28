import { join } from 'node:path';
import { BrowserWindow, Menu, app, ipcMain } from 'electron';
import { Harness } from './harness.js';

const harness = new Harness();

/**
 * Clean shutdown, executed exactly once and AWAITED by every exit path.
 * Without this guarantee, Electron quits while the KV save and the server
 * shutdown are still in flight — and the model survives the app.
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
 * Application icon: aparté's `('.')` mascot, the same one as the favicon of
 * apartejs.dev and of monaparte — a single mark for the whole family.
 *
 * Packaged, it will live in the resources; in development, it's at the root
 * of the app package. Packaging (J5) doesn't exist yet, but the path is
 * already there so we don't have to revisit it.
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
    // Background set before any paint to avoid the white flash; the renderer
    // then applies the real theme (data-aparte-theme attribute).
    backgroundColor: '#17141c',
    title: 'bonaparte',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM preload ⇒ sandbox disabled (Electron limitation). The renderer
      // has access to nothing but the typed API exposed via contextBridge.
      sandbox: false,
    },
  });

  harness.attachWindow(win);
  // Electron has no real headless mode: what we can do is NEVER show the
  // window. The renderer still runs, the DOM is alive, and the tests observe
  // exactly the same thing — without a window popping up in front of the
  // user on every run.
  if (!process.env['BONAPARTE_E2E']) {
    win.once('ready-to-show', () => win.show());
  }

  // On close: save the KV state and stop the server BEFORE letting the
  // window go.
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

// A harness for LOCAL models doesn't spend VRAM compositing pixels. The
// interface is text, lists, and diffs: it has nothing to ask of the GPU,
// whereas every megabyte of VRAM handed to the model is more context. Must
// be called BEFORE `whenReady`.
app.disableHardwareAcceleration();

// Windows groups and illustrates windows by this identifier: without it, the
// taskbar shows Electron's icon, regardless of the window's own. Must be set
// before the first window.
if (process.platform === 'win32') app.setAppUserModelId('dev.apartejs.bonaparte');

app.whenReady().then(async () => {
  // No menu bar: the app carries its own navigation. On macOS we keep it,
  // the system attaches the standard editing shortcuts to it.
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

// Belt and suspenders: even if the window skipped the close step (renderer
// crash, forced quit), the model server must never outlive the app. We DELAY
// the exit for the duration of the cleanup — a `void` wasn't enough:
// Electron was quitting before the kill even went out.
app.on('before-quit', (event) => {
  if (shutdownDone) return;
  event.preventDefault();
  void shutdownOnce().finally(() => app.quit());
});
