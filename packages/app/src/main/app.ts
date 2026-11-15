/**
 * The main process is glue: it builds the core, serves the window's scheme,
 * registers the IPC channels and opens the window. Nothing here decides
 * anything about a conversation.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray, utilityProcess } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { bonaparteDataDir, createAgentHandler, createCore, withoutSecrets, type Core } from '@aparte/bonaparte-core';
import { terminal, terminalManifest } from '@aparte/bonaparte-plugin-terminal';
import { APP_EVENT, type AppEvent, type Locale } from '@aparte/bonaparte-shared';
import { registerAppProtocol } from './agent-protocol.js';
import { e2eEngineDeps, e2ePickedFolder } from './e2e-engine.js';
import { mainWords, type MainWords } from './i18n/index.js';
import { registerAllChannels } from './ipc/index.js';
import { createIpcRegistry } from './ipc/register.js';
import { stopEngineBeforeQuit } from './quit.js';
import { devServerUrlFrom, isTrustedOrigin } from './security.js';
import { applyLaunchAtLogin, claimSingleInstance, hideOnClose, revealWindow, windowProfile } from './startup.js';
import { trayMenu, type TrayActions } from './tray.js';
// The terminals' own process: built apart by electron-vite, its path given here.
import ptyProcessPath from './terminals/pty-process?modulePath';
import { createTerminalService } from './terminals/pty-host.js';
import { findShells } from './terminals/shells.js';
import { createMainWindow } from './windows.js';

/** The language the person chose (the setting « language »), until it is read: the system's. */
let chosenLanguage: unknown = 'system';

/** The language of the interface: the person's choice, else French on a French system, English otherwise. */
function interfaceLocale(): Locale {
  const forced = process.env['BONAPARTE_LOCALE'];
  if (forced === 'fr' || forced === 'en') return forced;
  if (chosenLanguage === 'fr' || chosenLanguage === 'en') return chosenLanguage;
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

  // What the main process pushes to the window: a terminal's output, an agent's command.
  const push = (event: AppEvent): void => {
    if (window && !window.isDestroyed()) window.webContents.send(APP_EVENT, event);
  };
  // The terminals (task 6.6): the machine's shells, found once; node-pty in a process of its own.
  const shells = findShells(process.platform, process.env, existsSync);
  const engineDeps = e2eEngineDeps(process.env, options.e2e);
  const terminals = createTerminalService({
    shells: () => shells,
    start: () => utilityProcess.fork(ptyProcessPath, [], { serviceName: 'bonaparte-terminals', stdio: 'ignore' }),
    env: () => withoutSecrets(process.env),
    home: engineDeps.home ?? homedir(),
    log: (message) => console.log(message),
  });
  if (options.e2e) (globalThis as { __bonaparteTerminals?: unknown }).__bonaparteTerminals = terminals;
  const core = createCore({
    dataDir,
    // The answers are written in the language of the interface.
    replyLanguage: () => (interfaceLocale() === 'fr' ? 'French' : 'English'),
    terminals,
    pluginEvent: (pluginId, instanceId, event, payload) => push({ kind: 'plugin', pluginId, instanceId, event, payload }),
    commandOutput: (conversationId, output) => push({ kind: 'command', conversationId, output }),
    ...engineDeps,
  });
  // The built-in plugins, built with the app.
  core.plugins.add(terminalManifest, { builtin: true });
  const activated = await core.plugins.activate('terminal', terminal);
  if (!activated.active) console.error(`[bonaparte] the terminal did not start: ${activated.error ?? 'unknown'}`);
  registerAppProtocol({
    handler: createAgentHandler(core),
    rendererDir: join(import.meta.dirname, '..', 'renderer'),
    devServerUrl,
  });

  // The language before anything asks for it: the window's first words, the replies.
  chosenLanguage = await core.settings.get('language').catch(() => 'system');
  core.settings.onChange((key, value) => {
    if (key === 'language') chosenLanguage = value;
  });

  const ipc = createIpcRegistry({ ipcMain, isTrusted: (url) => isTrustedOrigin(url, devServerUrl) });
  registerAllChannels(ipc, core, {
    version: () => __BONAPARTE_VERSION__,
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
    // A test run opens no window of the system's: it notes that it would have.
    openDataFolder: async () => {
      if (options.e2e) {
        const record = globalThis as { __openedDataFolder?: string[] };
        (record.__openedDataFolder ??= []).push(dataDir);
        return;
      }
      const failed = await shell.openPath(dataDir);
      if (failed) throw new Error(failed);
    },
    // A pull request's page, which the core read.
    openLink: async (url) => {
      if (options.e2e) {
        const record = globalThis as { __openedLinks?: string[] };
        (record.__openedLinks ??= []).push(url);
        return;
      }
      await shell.openExternal(url);
    },
    // A conversation's own folder, which the core named.
    openFolder: async (path) => {
      if (options.e2e) {
        const record = globalThis as { __openedFolders?: string[] };
        (record.__openedFolders ??= []).push(path);
        return;
      }
      const failed = await shell.openPath(path);
      if (failed) throw new Error(failed);
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
