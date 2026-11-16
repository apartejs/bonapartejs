/**
 * The app's window and its notification area, driven from the main process:
 * what a person does with the window's own close button or with the icon in
 * the notification area. A test run puts nothing on the person's screen: the
 * app hands the test the menu it would have shown (`__bonaparteTray`), the
 * banners it would have shown (`__bonaparteNotifications`) and the state of
 * its icon and badge (`__bonaparteAttention`); `__bonaparteFocused` says
 * whether the window is in front of the person.
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

/** The labels of the notification area's menu, as Windows shows them (an item's second line after « — »). */
export function trayLabels(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() =>
    ((globalThis as { __bonaparteTray?: { label?: string; type?: string }[] }).__bonaparteTray ?? []).map((entry) =>
      entry.type === 'separator' ? '—' : (entry.label ?? ''),
    ),
  );
}

/** A click on an item of the notification area's menu, by its label (its second line left out). */
export function clickTrayItem(app: ElectronApplication, label: string): Promise<void> {
  return app
    .evaluate((_electron, wanted) => {
      const menu = (globalThis as { __bonaparteTray?: { label?: string; click?: () => void }[] }).__bonaparteTray;
      const item = menu?.find((entry) => entry.label === wanted || entry.label?.startsWith(`${wanted} — `));
      if (!item?.click) throw new Error(`No item « ${wanted} » in the tray's menu`);
      item.click();
    }, label)
    .catch((error: unknown) => {
      // « Quitter » takes the app away while it answers: that is the point.
      if (!/closed|Target/.test(String(error))) throw error;
    });
}

/** Whether the window is in front of the person, as the notifications see it. */
export function setFocused(app: ElectronApplication, focused: boolean): Promise<void> {
  return app.evaluate((_electron, value) => {
    (globalThis as { __bonaparteFocused?: boolean }).__bonaparteFocused = value;
  }, focused);
}

/** The banners the app would have shown, oldest first. */
export function banners(app: ElectronApplication): Promise<{ title: string; body: string; conversationId: string }[]> {
  return app.evaluate(() =>
    ((globalThis as { __bonaparteNotifications?: { title: string; body: string; conversationId: string }[] }).__bonaparteNotifications ?? []).map(
      ({ title, body, conversationId }) => ({ title, body, conversationId }),
    ),
  );
}

/** A click on a banner, the `index`-th shown. */
export function clickBanner(app: ElectronApplication, index: number): Promise<void> {
  return app.evaluate((_electron, at) => {
    const shown = (globalThis as { __bonaparteNotifications?: { click(): void }[] }).__bonaparteNotifications ?? [];
    if (!shown[at]) throw new Error(`No banner ${at}`);
    shown[at].click();
  }, index);
}

/** The icon of the notification area and the taskbar's badge, as drawn last. */
export function attentionShown(app: ElectronApplication): Promise<{ icon: string; badge: { kind: string; text: string } | null } | null> {
  return app.evaluate(() => (globalThis as { __bonaparteAttention?: { icon: string; badge: { kind: string; text: string } | null } }).__bonaparteAttention ?? null);
}
