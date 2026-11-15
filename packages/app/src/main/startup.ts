/**
 * How the app starts and ends (task 5.9).
 *
 * One app per data folder: the window's profile lives in the data folder, and
 * Electron's single-instance lock with it — a second launch brings the first
 * one's window back and quits; a test run, on its own data folder, never
 * meets the person's app. Closing the window hides it while « close to the
 * tray » says so (a reply keeps going, the engine keeps its model); quitting,
 * or Windows ending the session, closes it for real. « Launch at login » is
 * written to the system by an installed app only: never by a test run, never
 * by the app run from its sources (it would register Electron itself).
 */

import { join } from 'node:path';

interface StartupApp {
  setPath(name: 'userData', path: string): void;
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: 'second-instance' | 'before-quit', listener: () => void): unknown;
}

interface WindowLike {
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): unknown;
  on(event: 'session-end', listener: () => void): unknown;
  hide(): void;
  show(): void;
  showInactive(): void;
  focus(): void;
  restore(): void;
  isMinimized(): boolean;
}

/** Where the window's profile lives: in the data folder, so the single-instance lock follows the folder. */
export function windowProfile(dataDir: string): string {
  return join(dataDir, 'window');
}

/** False when another app holds this profile (its data folder): this one quits. The folder must exist. */
export function claimSingleInstance(app: StartupApp, profile: string, reveal: () => void): boolean {
  app.setPath('userData', profile);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', reveal);
  return true;
}

export function hideOnClose(app: Pick<StartupApp, 'on'>, window: WindowLike, enabled: () => boolean): void {
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });
  window.on('session-end', () => {
    quitting = true;
  });
  window.on('close', (event) => {
    if (quitting || !enabled()) return;
    event.preventDefault();
    window.hide();
  });
}

/** In front of the person — or, in a test run, shown without being activated: it stays off the screen. */
export function revealWindow(window: Pick<WindowLike, 'show' | 'showInactive' | 'focus' | 'restore' | 'isMinimized'>, e2e: boolean): void {
  if (e2e) {
    window.showInactive();
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/** True when the system was told; an app run from its sources, or a test run, never tells it. */
export function applyLaunchAtLogin(
  enabled: boolean,
  facts: { packaged: boolean; e2e: boolean; setLoginItem(settings: { openAtLogin: boolean }): void },
): boolean {
  if (!facts.packaged || facts.e2e) return false;
  facts.setLoginItem({ openAtLogin: enabled });
  return true;
}
