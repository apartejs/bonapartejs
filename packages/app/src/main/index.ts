import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, shell } from 'electron';
import { readFileSync } from 'node:fs';
import { bonaparteDataDir, wantsGpuAcceleration } from '@aparte/bonaparte-core';
import { Harness } from './harness.js';

// An isolated data directory isolates EVERYTHING: the renderer's localStorage
// (a conversation's tooling tabs) lives in Electron's userData, which would
// otherwise leak across profiles — and across E2E runs sharing an id.
const isolatedDataDir = process.env['BONAPARTE_DATA_DIR'];
if (isolatedDataDir) app.setPath('userData', join(isolatedDataDir, 'electron'));

// One bonaparte per data directory (the lock is scoped by userData, so an
// isolated profile is its own instance). A second launch would fight the
// first for the server's port and write the same conversations: it hands
// over — the running app shows its window — and leaves before touching
// anything. `exit`, not `quit`: nothing of ours has started, nothing to
// shut down.
const primary = app.requestSingleInstanceLock();
if (!primary) app.exit(0);

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

const rendererFile = join(import.meta.dirname, '../renderer/index.html');
const devUrl = process.env['ELECTRON_RENDERER_URL'];

/** The app's own page — the one place the main window may be. */
function isAppUrl(url: string): boolean {
  const bare = url.split(/[?#]/)[0] ?? '';
  if (devUrl) return bare.startsWith(devUrl);
  return bare.toLowerCase() === pathToFileURL(rendererFile).href.toLowerCase();
}

/**
 * A link out of the app — a reply's link, a doc page — goes to the system
 * browser, and only an http(s) one: `file:`, a custom protocol or a
 * `javascript:` URL is dropped. E2E records instead of opening a browser.
 */
function openLink(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  if (process.env['BONAPARTE_E2E']) {
    const scope = globalThis as { __bonaparteOpenedLinks?: string[] };
    (scope.__bonaparteOpenedLinks ??= []).push(url);
    return;
  }
  void shell.openExternal(url);
}

/**
 * The main window carries the preload — the whole bridge to the harness —
 * so it never leaves the app's page (audit 07, finding 1): a navigation is
 * refused, a new window becomes a system-browser tab. The plugins' web
 * views are other web contents, with their own rules.
 */
function lockToApp(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openLink(url);
    return { action: 'deny' };
  });
}

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
    minWidth: 480,
    minHeight: 520,
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
  lockToApp(win);
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

  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(rendererFile);
  }
}

// A harness for LOCAL models doesn't spend VRAM compositing pixels. The
// interface is text, lists, and diffs: it has nothing to ask of the GPU,
// whereas every megabyte of VRAM handed to the model is more context. A
// setting gives it back (the browser view renders real pages): Chromium
// fixes its GPU mode at startup, so it is read here, synchronously, from
// the saved config, and must be applied BEFORE `whenReady` (D-23, P3.1).
if (!wantsGpuAcceleration(readSavedConfig())) app.disableHardwareAcceleration();

function readSavedConfig(): unknown {
  try {
    return JSON.parse(readFileSync(join(bonaparteDataDir(), 'config', 'global.json'), 'utf8'));
  } catch {
    return null;
  }
}

// Windows groups and illustrates windows by this identifier: without it, the
// taskbar shows Electron's icon, regardless of the window's own. Must be set
// before the first window.
if (process.platform === 'win32') app.setAppUserModelId('dev.apartejs.bonaparte');

app.on('second-instance', () => {
  if (process.env['BONAPARTE_E2E']) {
    // The E2E window is never shown; the test reads that the hand-over came.
    const scope = globalThis as { __bonaparteSecondInstances?: number };
    scope.__bonaparteSecondInstances = (scope.__bonaparteSecondInstances ?? 0) + 1;
    return;
  }
  showWindow();
});

app.whenReady().then(async () => {
  if (!primary) return;
  // No menu bar: the app carries its own navigation. On macOS we keep it,
  // the system attaches the standard editing shortcuts to it.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

  harness.registerIpc(ipcMain, app.getVersion(), isAppUrl);
  harness.setShowWindow(showWindow);
  harness.watchPower();
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
