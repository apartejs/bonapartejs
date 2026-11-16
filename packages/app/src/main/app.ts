/**
 * The main process is glue: it builds the core, serves the window's scheme,
 * registers the IPC channels and opens the window. Nothing here decides
 * anything about a conversation.
 */

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
  utilityProcess,
  type MenuItemConstructorOptions,
  type NativeImage,
} from 'electron';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
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
import { createAttention, type Attention, type AttentionView } from './attention.js';
import { trayMenu, type EngineRow, type TrayActions, type TrayIcon, type Waiting } from './tray.js';
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
/** Kept until they are clicked or closed: a notification the garbage collector takes loses its click. */
const banners = new Set<Notification>();

/** An icon of `resources/icons/` (task 8.5), at every scale it was drawn for; a file missing is left out, never fatal. */
function icon(name: string, sizes: readonly number[]): NativeImage {
  const path = (size: number): string => join(app.getAppPath(), 'resources', 'icons', `${name}-${size}.png`);
  const image = nativeImage.createFromPath(path(sizes[0]!));
  for (const size of sizes.slice(1)) {
    if (existsSync(path(size))) image.addRepresentation({ scaleFactor: size / sizes[0]!, buffer: readFileSync(path(size)) });
  }
  return image;
}

/**
 * Being noticed when the window is not in front of the person (task 8.5): the icon in the notification area and
 * its menu, the banners, the taskbar's badge — `attention.ts` decides, this draws. A test run puts nothing on the
 * person's screen: it gets the menu, the banners and the state, to drive and read them.
 */
function wireAttention(options: {
  core: Core;
  e2e: boolean;
  window: () => BrowserWindow | undefined;
  words: () => MainWords;
  reveal(): void;
  open(conversationId: string): void;
}): Attention {
  const { core, e2e } = options;
  const record = globalThis as {
    __bonaparteTray?: MenuItemConstructorOptions[];
    __bonaparteAttention?: { icon: TrayIcon; badge: AttentionView['badge'] };
    __bonaparteNotifications?: { title: string; body: string; conversationId: string; click(): void }[];
    __bonaparteFocused?: boolean;
  };
  const icons = e2e
    ? null
    : {
        tray: Object.fromEntries((['rest', 'waiting', 'failure', 'asleep'] as const).map((state) => [state, icon(`tray-${state}`, [16, 24, 32])])) as Record<TrayIcon, NativeImage>,
        badge: { waiting: icon('badge-waiting', [16, 32]), failure: icon('badge-failure', [16, 32]), done: icon('badge-done', [16, 32]) },
      };
  // The video memory of each model, read once from the core's list (a scan of the model folders).
  const vram = new Map<string, number | null>();
  const vramOf = async (path: string): Promise<number | null> => {
    if (!vram.has(path)) {
      const listed = await core.models().catch(() => []);
      for (const model of listed) vram.set(model.path, model.announcement?.vramBytes ?? null);
      if (!vram.has(path)) vram.set(path, null);
    }
    return vram.get(path) ?? null;
  };
  // The menu's « Ne pas déranger » reaches the attention it is part of.
  const self: { attention?: Attention } = {};
  const actions: TrayActions = {
    open: options.reveal,
    openConversation: options.open,
    release: () => void core.unloadModel().catch((error: unknown) => console.error('[bonaparte] the model was not released:', error)),
    quiet: () => void self.attention?.toggleQuiet(),
    quit: () => app.quit(),
  };
  if (icons) {
    tray = new Tray(icons.tray.rest);
    tray.setToolTip(options.words().tray.tooltip);
    tray.on('click', options.reveal);
  }
  self.attention = createAttention({
    words: options.words,
    setting: async (event) => {
      const value = await core.settings.get(`notifications.${event}`).catch(() => undefined);
      return value === 'banner' || value === 'badge' || value === 'off' ? value : 'banner';
    },
    focused: () => {
      if (e2e && typeof record.__bonaparteFocused === 'boolean') return record.__bonaparteFocused;
      const window = options.window();
      return Boolean(window && !window.isDestroyed() && window.isVisible() && window.isFocused());
    },
    now: () => Date.now(),
    waiting: async () => {
      const inbox = await core.inbox();
      const rows = new Map<string, Waiting>();
      for (const one of [...inbox.approvals, ...inbox.subagentRequests]) rows.set(one.conversationId, { conversationId: one.conversationId, title: one.title, what: 'approval' });
      for (const one of inbox.questions) if (!rows.has(one.conversationId)) rows.set(one.conversationId, { conversationId: one.conversationId, title: one.title, what: 'question' });
      return { rows: [...rows.values()], unread: inbox.unread.length };
    },
    log: (message) => console.error(message),
    engine: async (): Promise<EngineRow | null> => {
      const state = await core.engineState();
      if (state.model) {
        const status = state.status === 'ready' ? 'ready' : state.status === 'starting' ? 'starting' : 'stopped';
        return { name: state.model.name, status, vramBytes: state.mode === 'managed' && status === 'ready' ? await vramOf(state.model.path) : null };
      }
      return state.resume ? { name: state.resume.name, status: 'asleep', vramBytes: null } : null;
    },
    show: (note) => {
      const open = (): void => options.open(note.conversationId);
      if (e2e) {
        (record.__bonaparteNotifications ??= []).push({ ...note, click: open });
        return;
      }
      if (!Notification.isSupported()) return;
      const banner = new Notification({ title: note.title, body: note.body });
      banners.add(banner);
      const done = (): void => void banners.delete(banner);
      banner.on('click', () => {
        done();
        open();
      });
      banner.on('close', done);
      banner.on('failed', done);
      banner.show();
    },
    render: (view) => {
      const menu = trayMenu(options.words(), view, actions, process.platform);
      if (e2e) {
        record.__bonaparteTray = menu;
        record.__bonaparteAttention = { icon: view.icon, badge: view.badge };
        return;
      }
      tray?.setImage(icons!.tray[view.icon]);
      tray?.setContextMenu(Menu.buildFromTemplate(menu));
      tray?.setToolTip(view.badge?.text ?? options.words().tray.tooltip);
      const window = options.window();
      if (window && !window.isDestroyed()) window.setOverlayIcon(view.badge ? icons!.badge[view.badge.kind] : null, view.badge?.text ?? '');
    },
  });
  return self.attention;
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

  // The icon in the notification area, the banners, the badge (task 8.5): made once the window exists.
  const noticing: { attention?: Attention } = {};
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
    engineChanged: () => {
      push({ kind: 'engine' });
      // The notification area says the engine's state too.
      void noticing.attention?.refresh();
    },
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
    // A conversation seen: a reply ready there leaves the taskbar's badge.
    seen: () => void noticing.attention?.refresh(),
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
  // Quitting saves the memory and stops the engine: said before anything else can go wrong (review of phase 8).
  app.on('window-all-closed', () => app.quit());
  stopEngineBeforeQuit(app, core);
  // Windows shows the banners of an app that has a name of its own.
  if (process.platform === 'win32' && !options.e2e) app.setAppUserModelId(app.isPackaged ? 'dev.aparte.bonaparte' : process.execPath);
  // A banner, or the menu of the icon, opens its conversation in the window — nothing more.
  const openConversation = (conversationId: string): void => {
    reveal();
    push({ kind: 'open', conversationId });
  };
  const noticed = wireAttention({
    core,
    e2e: options.e2e,
    window: () => window,
    words: () => mainWords(interfaceLocale()),
    reveal,
    open: openConversation,
  });
  noticing.attention = noticed;
  // None of these ever rejects (attention.ts logs what fails): the app goes on, whatever a drawing does.
  core.onTurnEnd((end) => void noticed.turnEnded(end));
  // Back in front of the window: a failure was seen, and what waits is read again.
  window.on('focus', () => {
    void noticed.focused();
    void noticed.refresh();
  });
  core.settings.onChange((key, value) => {
    if (key === 'closeToTray') closeToTray = value === true;
    if (key === 'launchAtLogin') loginItem(value === true);
    if (key === 'language' || key.startsWith('notifications.')) void noticed.refresh();
  });
  // The first drawing reads every conversation: the window does not wait for it.
  void noticed.refresh();
}
