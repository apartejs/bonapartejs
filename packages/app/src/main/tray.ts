/**
 * The notification area (task 5.9; the engine's state, the approvals waiting
 * and « Ne pas déranger » come with 8.5): « Ouvrir bonaparte » brings the
 * window back, « Quitter » quits — the engine stopped, the memory saved. A
 * click on the icon opens the window too.
 *
 * Its icon is the app's own executable's until the bicorne's icons exist
 * (8.5, 12.2). A test run puts no icon in the person's notification area: it
 * gets the menu's actions instead, to drive them.
 */

import type { MenuItemConstructorOptions } from 'electron';
import type { MainWords } from './i18n/index.js';

export interface TrayActions {
  open(): void;
  quit(): void;
}

export function trayMenu(words: MainWords['tray'], actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: words.open, click: () => actions.open() },
    { type: 'separator' },
    { label: words.quit, click: () => actions.quit() },
  ];
}
