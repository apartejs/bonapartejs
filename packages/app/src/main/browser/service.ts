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
import { BrowserViews, readingSignal, windowHost, type PageView } from './views.js';

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
  // « L'agent lit la page » shows for 1.5 s at least: a read is over in milliseconds.
  const reading = readingSignal(options.changed, 1500);

  const views = new BrowserViews({
    create: (): PageView => {
      const view = new WebContentsView({ webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      const contents = view.webContents;
      return {
        setBounds: (rect) => view.setBounds(rect),
        webContents: {
          id: contents.id,
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
    host: windowHost(options.window as () => BrowserWindow | undefined),
    changed: options.changed,
    // Chromium's own answers for a name, its cache read, stale ones included: what the page connected to.
    pageLookup: async (host) =>
      (await session.resolveHost(host, { cacheUsage: 'staleAllowed', source: 'any' })).endpoints.map((endpoint) => endpoint.address),
  });
  // Where Chromium really connected decides what the agent may read; a private address written as one is never asked
  // by a page the agent opened (audit 13.4).
  session.webRequest.onBeforeRequest((details, callback) => {
    if (details.webContentsId === undefined) return callback({});
    views.blocked(details.webContentsId, details.url).then(
      (cancel) => callback({ cancel }),
      () => callback({}),
    );
  });
  // Behind a proxy, the address Electron gives is the proxy's: only a direct connection says where the page is.
  const responded = (details: { url: string; webContentsId?: number; ip?: string }): void => {
    const { webContentsId, ip } = details;
    if (webContentsId === undefined || !ip) return;
    void session.resolveProxy(details.url).then(
      (proxy) => {
        if (proxy.trim().toUpperCase() === 'DIRECT') views.responded(webContentsId, ip);
      },
      () => undefined,
    );
  };
  // The address a request was really sent to: Electron says it once the response is over, or at a redirect.
  session.webRequest.onBeforeRedirect((details) => responded(details));
  // Electron 45 does not type it here; where it gives it, it counts.
  session.webRequest.onCompleted((details) => responded(details as typeof details & { ip?: string }));

  const service: BrowserService = {
    open: (url) => views.agentOpen(url),
    openFile: (path, root, options) => views.agentOpenFile(path, root, options),
    read: () => reading.during(() => views.agentRead()),
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

  return { views, service, reading: () => reading.on(), dispose: () => views.dispose() };
}
