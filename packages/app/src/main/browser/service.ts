/**
 * The built-in browser's glue with Electron (task 10.1): its pages are WebContentsViews in a session of their
 * own — in memory, no preload, no permission —, placed on the main window's content view; the agent's side is
 * the `BrowserService` the core gives the browser plugin. A screenshot is kept in the data folder, for the
 * person; the window hears that something changed and reads the tabs again.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserService } from '@aparte/bonaparte-shared';
import { session as sessions, WebContentsView, type BrowserWindow } from 'electron';
import { BrowserViews, type PageView } from './views.js';

export interface BuiltinBrowser {
  views: BrowserViews;
  service: BrowserService;
  /** The agent reads the page shown now. */
  reading(): boolean;
  dispose(): void;
}

export function createBuiltinBrowser(options: { window: () => BrowserWindow | undefined; dataDir: string; changed: () => void }): BuiltinBrowser {
  const session = sessions.fromPartition('bonaparte-browser');
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.on('will-download', (event) => event.preventDefault());
  let reading = false;

  const views = new BrowserViews({
    create: (): PageView => {
      const view = new WebContentsView({ webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      const contents = view.webContents;
      return {
        setBounds: (rect) => view.setBounds(rect),
        webContents: {
          loadURL: (url) => contents.loadURL(url),
          getURL: () => contents.getURL(),
          getTitle: () => contents.getTitle(),
          canGoBack: () => contents.navigationHistory.canGoBack(),
          goBack: () => contents.navigationHistory.goBack(),
          reload: () => contents.reload(),
          stop: () => contents.stop(),
          executeJavaScript: (code, gesture) => contents.executeJavaScript(code, gesture),
          capturePage: () => contents.capturePage(),
          on: (event, listener) => void contents.on(event as 'did-navigate', listener as () => void),
          setWindowOpenHandler: (handler) => contents.setWindowOpenHandler(handler),
          close: () => contents.close(),
        },
        // The native view itself, for the window's content view.
        ...({ native: view } as object),
      } as PageView;
    },
    host: {
      attach: (view) => options.window()?.contentView.addChildView((view as unknown as { native: WebContentsView }).native),
      detach: (view) => options.window()?.contentView.removeChildView((view as unknown as { native: WebContentsView }).native),
    },
    changed: options.changed,
  });

  const service: BrowserService = {
    open: (url) => views.agentOpen(url),
    async read() {
      reading = true;
      options.changed();
      try {
        return await views.agentRead();
      } finally {
        reading = false;
        options.changed();
      }
    },
    async screenshot() {
      const shot = await views.agentScreenshot();
      if (!shot) return null;
      const folder = join(options.dataDir, 'screenshots');
      await mkdir(folder, { recursive: true });
      const saved = join(folder, `${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      await writeFile(saved, shot.png);
      return { url: shot.url, width: shot.width, height: shot.height, saved };
    },
    act: (action) => views.agentAct(action),
  };

  return { views, service, reading: () => reading, dispose: () => views.dispose() };
}
