/**
 * The main process is glue: it builds the core, serves the window's scheme,
 * registers the IPC channels and opens the window. Nothing here decides
 * anything about a conversation.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, Tray } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { bonaparteDataDir, createAgentHandler, createCore, type Core } from '@aparte/bonaparte-core';
import type { Locale } from '@aparte/bonaparte-shared';
import { registerAppProtocol } from './agent-protocol.js';
import { e2eEngineDeps, e2ePickedFolder } from './e2e-engine.js';
import { mainWords, type MainWords } from './i18n/index.js';
import { registerAllChannels } from './ipc/index.js';
import { createIpcRegistry } from './ipc/register.js';
import { stopEngineBeforeQuit } from './quit.js';
import { devServerUrlFrom, isTrustedOrigin } from './security.js';
import { applyLaunchAtLogin, claimSingleInstance, hideOnClose, revealWindow, windowProfile } from './startup.js';
import { trayMenu, type TrayActions } from './tray.js';
import { createMainWindow } from './windows.js';

/** The language of the interface: French on a French system, English otherwise. */
function interfaceLocale(): Locale {
  const forced = process.env['BONAPARTE_LOCALE'];
  if (forced === 'fr' || forced === 'en') return forced;
  return app.getLocale().toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

/** Kept here: a tray the garbage collector takes leaves the notification area. */
let tray: Tray | undefined;

/**
 * The icon in the notification area — the app's own executable's icon until the bicorne's exist
 * (8.5, 12.2). A test run puts nothing in the person's notification area: it gets the menu, to drive it.
 */
async function installTray(words: MainWords['tray'], actions: TrayActions, e2e: boolean): Promise<void> {
  const menu = trayMenu(words, actions);
  if (e2e) {
    (globalThis as { __bonaparteTray?: unknown }).__bonaparteTray = menu;
    return;
  }
  tray = new Tray(await app.getFileIcon(process.execPath, { size: 'small' }));
  tray.setToolTip(words.tooltip);
  tray.setContextMenu(Menu.buildFromTemplate(menu));
  tray.on('click', () => actions.open());
}

/** A setting as the person left it; its default when the file cannot be read (the app starts anyway). */
async function setting(core: Core, key: string, fallback: boolean): Promise<boolean> {
  try {
    return (await core.settings.get(key)) === true;
  } catch (error) {
    console.error(`[bonaparte] the setting ${key} could not be read:`, error);
    return fallback;
  }
}

export async function startApp(options: { e2e: boolean }): Promise<void> {
  // In development, the dev server that serves the window; never in a packaged app.
  const devServerUrl = devServerUrlFrom(process.env, app.isPackaged);
  const dataDir = bonaparteDataDir();

  // One app per data folder: a second launch brings this window back, and quits.
  let window: BrowserWindow | undefined = undefined;
  const reveal = (): void => {
    if (window && !window.isDestroyed()) revealWindow(window, options.e2e);
  };
  const profile = windowProfile(dataDir);
  mkdirSync(profile, { recursive: true });
  if (!claimSingleInstance(app, profile, reveal)) return;

  await app.whenReady();

  const core = createCore({
    dataDir,
    // The answers are written in the language of the interface.
    replyLanguage: () => (interfaceLocale() === 'fr' ? 'French' : 'English'),
    ...e2eEngineDeps(process.env, options.e2e),
  });
  registerAppProtocol({
    handler: createAgentHandler(core),
    rendererDir: join(import.meta.dirname, '..', 'renderer'),
    devServerUrl,
  });

  const ipc = createIpcRegistry({ ipcMain, isTrusted: (url) => isTrustedOrigin(url, devServerUrl) });
  registerAllChannels(ipc, core, {
    version: () => app.getVersion(),
    locale: interfaceLocale,
    // The system's folder dialog, over the window — or the test's folder in a test run.
    chooseFolder: async () => {
      const picked = e2ePickedFolder(process.env, options.e2e);
      if (picked !== undefined) return picked;
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const result = window
        ? await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
        : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  });

  window = createMainWindow({ devServerUrl, e2e: options.e2e });

  // Closing the window hides it while « close to the tray » says so: a reply goes on, the model stays.
  let closeToTray = await setting(core, 'closeToTray', true);
  hideOnClose(app, window, () => closeToTray);
  // « Launch at login »: told to the system by an installed app only.
  const loginItem = (enabled: boolean): boolean =>
    applyLaunchAtLogin(enabled, {
      packaged: app.isPackaged,
      e2e: options.e2e,
      setLoginItem: (settings) => app.setLoginItemSettings(settings),
    });
  loginItem(await setting(core, 'launchAtLogin', false));
  core.settings.onChange((key, value) => {
    if (key === 'closeToTray') closeToTray = value === true;
    if (key === 'launchAtLogin') loginItem(value === true);
  });
  await installTray(mainWords(interfaceLocale()).tray, { open: reveal, quit: () => app.quit() }, options.e2e);

  app.on('window-all-closed', () => app.quit());
  stopEngineBeforeQuit(app, core);
}
