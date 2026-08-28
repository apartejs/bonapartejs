import { join } from 'node:path';
import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage } from 'electron';
import { Harness } from './harness.js';

// An isolated data directory isolates EVERYTHING: the renderer's localStorage
// (a conversation's tooling tabs) lives in Electron's userData, which would
// otherwise leak across profiles — and across E2E runs sharing an id.
const isolatedDataDir = process.env['BONAPARTE_DATA_DIR'];
if (isolatedDataDir) app.setPath('userData', join(isolatedDataDir, 'electron'));

const harness = new Harness();

// Closing the window keeps bonaparte in the notification area (a setting);
// a real quit — the tray's "Quit", or the OS asking — sets this so the close
// handler stops the engine and lets the window go. In E2E the window is
// always a real close, or `app.close()` would hang on a hidden window.
let quitting = false;
const trayEnabled = !process.env['BONAPARTE_E2E'];

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

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;

function showWindow(): void {
  const win = mainWindow;
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * A tray icon so bonaparte can wait out of the way with its model kept
 * warm — a click brings the window back, and "Quit" is the only way out
 * when the window closes to the tray. Windows and Linux show it in the
 * notification area; macOS in the menu bar.
 */
function createTray(): void {
  if (!trayEnabled || tray) return;
  const image = nativeImage.createFromPath(iconPath());
  try {
    tray = new Tray(image.isEmpty() ? iconPath() : image);
  } catch {
    tray = null; // no notification area (a bare Linux session): the app just runs windowed
    return;
  }
  const fr = harness.uiLocale === 'fr';
  tray.setToolTip('bonaparte');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: fr ? 'Ouvrir bonaparte' : 'Open bonaparte', click: () => showWindow() },
      { type: 'separator' },
      {
        label: fr ? 'Quitter' : 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  // A left click is the fastest way back to the window.
  tray.on('click', () => showWindow());
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
    backgroundColor: '#16181d',
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
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  harness.attachWindow(win);
  // Electron has no real headless mode: what we can do is NEVER show the
  // window. The renderer still runs, the DOM is alive, and the tests observe
  // exactly the same thing — without a window popping up in front of the
  // user on every run.
  if (!process.env['BONAPARTE_E2E']) {
    win.once('ready-to-show', () => win.show());
  }

  // On close: three cases.
  win.on('close', (event) => {
    // Already torn down: let the window go.
    if (shutdownDone) return;
    // Close to the tray: bonaparte keeps running and waiting, its model warm
    // until the idle timer unloads it. Nothing is stopped, nothing is saved
    // now — the window merely disappears.
    if (trayEnabled && !quitting && harness.closeToTray) {
      event.preventDefault();
      win.hide();
      return;
    }
    // A real quit: stop the server and save the state BEFORE letting go.
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
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
});

app.on('window-all-closed', () => {
  // A window closed to the tray is HIDDEN, not destroyed, so this does not
  // fire then — the app stays alive as intended. It fires on a real close.
  if (process.platform !== 'darwin') app.quit();
});

// Belt and suspenders: even if the window skipped the close step (renderer
// crash, forced quit), the model server must never outlive the app. We DELAY
// the exit for the duration of the cleanup — a `void` wasn't enough:
// Electron was quitting before the kill even went out.
app.on('before-quit', (event) => {
  quitting = true;
  if (shutdownDone) return;
  event.preventDefault();
  void shutdownOnce().finally(() => app.quit());
});
