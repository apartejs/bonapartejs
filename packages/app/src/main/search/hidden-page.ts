/**
 * The web search without a key (task 10.4, ported from v0): a hidden window of the main process — we are
 * Chromium already — that loads a public engine's result page and reads it. Nothing leaves the machine but the
 * query. The engine is DuckDuckGo's HTML endpoint: server-rendered, no script needed, stable markup
 * (`.result`, `a.result__a`, `.result__snippet`), verified on 2026-08-28.
 *
 * Harder than v0's: a session of its own, in memory only; nothing but the engine's own host is let through —
 * never this machine, the network it is in, nor a tracker; no permission, no window of its own; a search
 * stopped with its turn stops the page. One window, made at the first search, one load at a time, closed after
 * a minute of silence and with the app. It is never shown: `show: false`, out of the taskbar, never focused.
 */

/** What the page yields, before the core normalises it. */
export interface RawSearchResult {
  title: string;
  href: string;
  snippet: string;
}

/** The part of a BrowserWindow it uses (a fake one in tests). */
export interface HiddenWindow {
  webContents: {
    loadURL(url: string): Promise<void>;
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
    setUserAgent(agent: string): void;
    setAudioMuted(muted: boolean): void;
    setWindowOpenHandler(handler: () => { action: 'deny' }): void;
    stop(): void;
  };
  isDestroyed(): boolean;
  destroy(): void;
}

/** The part of its session it uses. */
export interface SearchSession {
  webRequest: {
    onBeforeRequest(listener: (details: { url: string }, callback: (answer: { cancel: boolean }) => void) => void): void;
  };
  setPermissionRequestHandler(handler: (webContents: unknown, permission: string, callback: (granted: boolean) => void) => void): void;
}

export interface HiddenSearchOptions {
  /** Makes the hidden window, in `session` (Electron's BrowserWindow, `show: false`). */
  window(session: SearchSession): HiddenWindow;
  /** Its own session, in memory: no cookie of the person's, none kept. */
  session(): SearchSession;
  /** The engine's address, the query appended (DuckDuckGo's HTML endpoint; a local fake one in tests). */
  engine?: string;
}

export const DUCKDUCKGO = 'https://html.duckduckgo.com/html/?q=';

/** A browser's UA, not Electron's: some engines answer an unknown one with a verification page. */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
const LOAD_TIMEOUT_MS = 20_000;
const IDLE_MS = 60_000;

const EXTRACT_RESULTS = `(() => {
  if (document.querySelector('.anomaly-modal, #challenge-form, form[action*="challenge"]')) {
    return { blocked: true, results: [] };
  }
  const results = [];
  for (const el of document.querySelectorAll('.result:not(.result--ad)')) {
    const link = el.querySelector('a.result__a');
    if (!link) continue;
    const snippet = el.querySelector('.result__snippet');
    results.push({
      title: (link.textContent || '').trim(),
      href: link.getAttribute('href') || '',
      snippet: (snippet ? snippet.textContent || '' : '').trim(),
    });
  }
  return { blocked: false, results };
})()`;

export interface HiddenSearch {
  search(query: string, max: number, signal?: AbortSignal): Promise<RawSearchResult[]>;
  dispose(): void;
}

export function createHiddenSearch(options: HiddenSearchOptions): HiddenSearch {
  const engine = options.engine ?? DUCKDUCKGO;
  const engineHost = new URL(engine).host;
  let win: HiddenWindow | null = null;
  let session: SearchSession | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function sessionOf(): SearchSession {
    if (session) return session;
    session = options.session();
    // Nothing but the engine's own host: never this machine, its network, nor a tracker the page would call.
    session.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false;
      try {
        const url = new URL(details.url);
        allowed = (url.protocol === 'https:' || url.protocol === 'http:') && url.host === engineHost;
      } catch {
        allowed = false;
      }
      callback({ cancel: !allowed });
    });
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    return session;
  }

  function windowOf(): HiddenWindow {
    if (win && !win.isDestroyed()) return win;
    win = options.window(sessionOf());
    win.webContents.setUserAgent(USER_AGENT);
    win.webContents.setAudioMuted(true);
    // A page must never open windows of its own from here.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return win;
  }

  function touch(): void {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => dispose(), IDLE_MS);
    idle.unref?.();
  }

  function dispose(): void {
    if (idle) clearTimeout(idle);
    idle = null;
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
  }

  return {
    search(query, _max, signal) {
      const task = queue.then(async () => {
        if (signal?.aborted) throw new Error('The search was stopped.');
        const page = windowOf();
        touch();
        const url = `${engine}${encodeURIComponent(query)}`;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onAbort: (() => void) | undefined;
        const stopped = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`The search engine did not answer in ${LOAD_TIMEOUT_MS / 1000} s.`)), LOAD_TIMEOUT_MS);
          onAbort = () => {
            if (!page.isDestroyed()) page.webContents.stop();
            reject(new Error('The search was stopped.'));
          };
          signal?.addEventListener('abort', onAbort, { once: true });
        });
        // A race lost leaves this promise rejected later, with nobody listening: that is expected.
        stopped.catch(() => undefined);
        try {
          await Promise.race([page.webContents.loadURL(url), stopped]);
          const read = (await Promise.race([page.webContents.executeJavaScript(EXTRACT_RESULTS, true), stopped])) as {
            blocked: boolean;
            results: RawSearchResult[];
          };
          if (read.blocked) {
            throw new Error(
              'The search engine asked for a verification instead of answering (too many requests from this machine). Try again in a while, or choose an online provider in the settings of bonaparte.',
            );
          }
          return read.results;
        } finally {
          clearTimeout(timer);
          // The search has ended: its turn's signal no longer reaches the page, which may be gone by then.
          if (onAbort) signal?.removeEventListener('abort', onAbort);
        }
      });
      // The queue survives a failure: the next search runs after it.
      queue = task.catch(() => undefined);
      return task;
    },
    dispose,
  };
}
