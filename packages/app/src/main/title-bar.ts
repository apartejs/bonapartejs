/**
 * The window's title bar is the app's (Paul, 2026-11-19): on Windows and Linux the system's bar is hidden, and its
 * buttons — reduce, enlarge, close, with Snap Layouts on Windows — are drawn by the system over the app
 * (`titleBarOverlay`), in the colours the page sends from its tokens (`window.titleBar`). The page keeps their place
 * free (`env(titlebar-area-*)`) and moves the window by its top strip. A Mac keeps its own frame for now.
 */

import type { BrowserWindowConstructorOptions } from 'electron';

/** The height of the strip the system's buttons sit in, and that moves the window. */
export const TITLE_BAR_HEIGHT = 40;

export function windowChrome(platform: NodeJS.Platform): Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'titleBarOverlay'> {
  if (platform !== 'win32' && platform !== 'linux') return {};
  return { titleBarStyle: 'hidden', titleBarOverlay: { height: TITLE_BAR_HEIGHT } };
}
