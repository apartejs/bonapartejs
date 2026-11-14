/**
 * The window of the app. It runs our pages and nothing else: no Node in the
 * page, a sandboxed preload, and no way out — it never navigates away from the
 * app and never opens another window.
 */

import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { APP_ORIGIN } from '@aparte/bonaparte-shared';
import { isTrustedOrigin } from './security.js';

export interface MainWindowOptions {
  devServerUrl?: string | undefined;
  /** A test run: the window is never shown, so it can never take the foreground. */
  e2e: boolean;
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'bonaparte',
    webPreferences: {
      preload: join(import.meta.dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A window that is never shown must still render, for the tests to read it.
      backgroundThrottling: !options.e2e,
    },
  });

  const contents = window.webContents;
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedOrigin(url, options.devServerUrl)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (!options.e2e) window.once('ready-to-show', () => window.show());

  void window.loadURL(options.devServerUrl ?? `${APP_ORIGIN}/index.html`);
  return window;
}
