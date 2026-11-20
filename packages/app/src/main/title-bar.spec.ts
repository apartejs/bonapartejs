/**
 * The window's title bar is the app's (Paul, 2026-11-19): on Windows and Linux the system's bar is hidden and its
 * buttons are drawn over the app (`titleBarOverlay`) in the app's colours; a Mac keeps its own frame for now.
 */

import { describe, expect, it } from 'vitest';
import { TITLE_BAR_HEIGHT, windowChrome } from './title-bar.js';

describe('the window’s title bar', () => {
  it('on Windows and Linux: the system’s bar hidden, its buttons over the app, at the bar’s height', () => {
    for (const platform of ['win32', 'linux'] as const) {
      expect(windowChrome(platform)).toEqual({ titleBarStyle: 'hidden', titleBarOverlay: { height: TITLE_BAR_HEIGHT } });
    }
    expect(TITLE_BAR_HEIGHT).toBe(40);
  });

  it('on a Mac: its own frame, as it was', () => {
    expect(windowChrome('darwin')).toEqual({});
  });
});
