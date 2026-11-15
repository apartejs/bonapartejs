/**
 * The app's window and its notification area, driven from the main process:
 * what a person does with the window's own close button or with the icon in
 * the notification area. A test run puts no icon there: the app hands the
 * test the menu it would have shown (`__bonaparteTray`).
 */

import type { ElectronApplication } from '@playwright/test';

/** Is the window on the screen (for a test run: shown, off the screen)? */
export function windowShown(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);
}

/** The window's close button. Returns at once: the app may quit before it answers. */
export function closeWindow(app: ElectronApplication): void {
  void app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close()).catch(() => undefined);
}

/** A click on an item of the notification area's menu, by its label. */
export function clickTrayItem(app: ElectronApplication, label: string): Promise<void> {
  return app
    .evaluate((_electron, wanted) => {
      const menu = (globalThis as { __bonaparteTray?: { label?: string; click?: () => void }[] }).__bonaparteTray;
      const item = menu?.find((entry) => entry.label === wanted);
      if (!item?.click) throw new Error(`No item « ${wanted} » in the tray's menu`);
      item.click();
    }, label)
    .catch((error: unknown) => {
      // « Quitter » takes the app away while it answers: that is the point.
      if (!/closed|Target/.test(String(error))) throw error;
    });
}
