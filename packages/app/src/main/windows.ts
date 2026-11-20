/**
 * The window of the app. It runs our pages and nothing else: no Node in the
 * page, a sandboxed preload, and no way out — it never navigates away from the
 * app and never opens another window.
 */

import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { APP_ORIGIN } from '@aparte/bonaparte-shared';
import { isOwnPage, isPermissionAllowed } from './security.js';
import { windowChrome } from './title-bar.js';

export interface MainWindowOptions {
  devServerUrl?: string | undefined;
  /** A test run: the window stays off the person's screen, and is never activated. */
  e2e: boolean;
}

/** Where a test run parks its window: far off any screen. */
const OFF_SCREEN = -32_000;

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'bonaparte',
    // The title bar is the app's: the system's buttons drawn over it, in its colours (main/title-bar.ts).
    ...windowChrome(process.platform),
    // The app's icon (task 12.2): the starry night of the board « Logo », drawn by scripts/make-icons.mjs.
    icon: join(app.getAppPath(), 'resources', 'icons', 'app-256.png'),
    // A test run: invisible from the first instant, whatever shows it later.
    ...(options.e2e ? { x: OFF_SCREEN, y: OFF_SCREEN, opacity: 0, skipTaskbar: true } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A window nobody sees must still render at full speed, for the tests to read it.
      backgroundThrottling: !options.e2e,
    },
  });

  // The window is one page, and it stays on it. A link in a reply — to a file,
  // to the root of the app, to a site — must not replace the conversation.
  const ownPage = options.devServerUrl ?? `${APP_ORIGIN}/index.html`;
  const contents = window.webContents;
  contents.on('will-navigate', (event, url) => {
    if (!isOwnPage(url, ownPage)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // The page is granted nothing but the clipboard's write, asked or checked.
  contents.session.setPermissionRequestHandler((_contents, permission, answer) => answer(isPermissionAllowed(permission)));
  contents.session.setPermissionCheckHandler((_contents, permission) => isPermissionAllowed(permission));

  if (!options.e2e) {
    window.once('ready-to-show', () => window.show());
  } else {
    // Electron has no headless mode, and the tests must not put a window in
    // front of the person. But a window that is never shown paints no frame:
    // transitions freeze half way, and every click waits for a frame that does
    // not come. So it is shown — off the screen, transparent, deaf to the
    // mouse, out of the taskbar, and without being activated. The tests drive
    // it through the debugging protocol. (A lesson of the first implementation.)
    window.once('ready-to-show', () => {
      window.setSkipTaskbar(true);
      window.setIgnoreMouseEvents(true);
      window.setOpacity(0);
      window.setPosition(OFF_SCREEN, OFF_SCREEN);
      window.showInactive();
    });
  }

  void window.loadURL(ownPage);
  return window;
}
