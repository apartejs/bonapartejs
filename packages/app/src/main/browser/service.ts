/**
 * The built-in browser's glue with Electron (task 10.1): its pages are WebContentsViews — no preload, no
 * permission —, placed on the main window's content view; the agent's side is the `BrowserService` the core gives
 * the browser plugin. Each tab lives in its owner's session, every one made by one factory that guards it
 * (`sessions.ts`): the person's, kept; each project's agent's, kept; an agent's with no project, in memory (the
 * browser redo, step 2). A screenshot is kept in the data folder, for the person; the window hears that something
 * changed and reads the tabs again.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserService } from '@aparte/bonaparte-shared';
import { session as sessions, WebContentsView, type BrowserWindow, type Session } from 'electron';
import { browserSessions, partitionOf, type TabOwner } from './sessions.js';
import { BrowserViews, readingSignal, windowHost, type PageView } from './views.js';

export interface BuiltinBrowser {
  views: BrowserViews;
  service: BrowserService;
  /** The agent reads a page now. */
  reading(): boolean;
  dispose(): void;
}

export function createBuiltinBrowser(options: {
  window: () => BrowserWindow | undefined;
  dataDir: string;
  changed: () => void;
  /** The agent of a conversation opened a page: the window shows it (the browser redo, step 1). */
  opened?: (conversationId: string) => void;
}): BuiltinBrowser {
  // « L'agent lit la page » shows for 1.5 s at least: a read is over in milliseconds.
  const reading = readingSignal(options.changed, 1500);
  // The views judge every request of a page, and hear where it answered from: the guards of every session. A session
  // is made only for a tab's page, once the views are.
  const sessionFor = browserSessions<Session>({
    fromPartition: (partition) => sessions.fromPartition(partition),
    guards: {
      blocked: (webContentsId, url) => views.blocked(webContentsId, url),
      responded: (webContentsId, ip) => views.responded(webContentsId, ip),
    },
  });
  const sessionOf = (owner: TabOwner): Session => sessionFor(partitionOf(owner));

  const views: BrowserViews = new BrowserViews({
    create: (owner): PageView => {
      const view = new WebContentsView({ webPreferences: { session: sessionOf(owner), sandbox: true, contextIsolation: true, nodeIntegration: false } });
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
    // Chromium's own answers for a name, in the tab's own session, its cache read, stale ones included: what the
    // page connected to.
    pageLookup: async (host, owner) =>
      (await sessionOf(owner).resolveHost(host, { cacheUsage: 'staleAllowed', source: 'any' })).endpoints.map((endpoint) => endpoint.address),
  });

  // A page the agent opened is shown to the person: the window opens its pane.
  const shown =
    (conversationId: string) =>
    <T extends object>(result: T): T => {
      if (!('error' in result)) options.opened?.(conversationId);
      return result;
    };
  const service: BrowserService = {
    open: (url, from) => views.agentOpen(url, from).then(shown(from.conversationId)),
    openFile: (path, root, from) => views.agentOpenFile(path, root, from).then(shown(from.conversationId)),
    read: (from) => reading.during(() => views.agentRead(from)),
    async screenshot(from) {
      const shot = await views.agentScreenshot(from);
      if (!shot) return null;
      const folder = join(options.dataDir, 'screenshots');
      await mkdir(folder, { recursive: true });
      const saved = join(folder, `${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      await writeFile(saved, shot.png);
      return { url: shot.url, width: shot.width, height: shot.height, saved };
    },
    act: (action, from) => views.agentAct(action, from),
  };

  return { views, service, reading: () => reading.on(), dispose: () => views.dispose() };
}
