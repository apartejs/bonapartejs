/**
 * The embedded searcher: a hidden Electron window — we are Chromium already,
 * no Playwright to ship — that loads a public engine's result page and
 * reads it, and that reads any page's text for `web_fetch`.
 *
 * One window, created on first use, one load at a time, closed after a
 * minute of silence and with the plugin. Nothing leaves the machine but the
 * query. The engine is DuckDuckGo's HTML endpoint: server-rendered, no
 * script needed, stable markup (`.result`, `a.result__a`,
 * `.result__snippet`), verified on 2026-08-28.
 */

import { BrowserWindow } from 'electron';
import { normalizeEmbeddedResults, type PageText, type RawResult, type SearchResult } from './providers.js';

/** A browser's UA, not Electron's: some engines answer an unknown one with a verification page. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
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

const EXTRACT_TEXT = `(() => {
  // An article first: on GitHub the README is an <article> inside a <main> that also carries the repository's chrome.
  const root = document.querySelector('article, main, [role="main"]') || document.body;
  return { title: document.title || '', text: root ? root.innerText || '' : '' };
})()`;

interface ExtractedResults {
  blocked: boolean;
  results: RawResult[];
}

export class HiddenPage {
  private win: BrowserWindow | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private window(): BrowserWindow {
    if (!this.win || this.win.isDestroyed()) {
      this.win = new BrowserWindow({
        show: false,
        width: 1024,
        height: 768,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          images: false,
          backgroundThrottling: false,
        },
      });
      this.win.webContents.setUserAgent(USER_AGENT);
      this.win.webContents.setAudioMuted(true);
      // A page must never open windows of its own from here.
      this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    }
    return this.win;
  }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.dispose(), IDLE_MS);
    this.idle.unref?.();
  }

  /** Loads a URL and runs a script in the page; loads are serialised on the one window. */
  private run<T>(url: string, script: string): Promise<T> {
    const task = this.queue.then(async () => {
      const win = this.window();
      this.touch();
      const load = win.webContents.loadURL(url);
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`The page did not load in ${LOAD_TIMEOUT_MS / 1000} s: ${url}`)), LOAD_TIMEOUT_MS),
      );
      await Promise.race([load, timeout]);
      return (await win.webContents.executeJavaScript(script, true)) as T;
    });
    // The queue survives a failure: the next request runs after it.
    this.queue = task.catch(() => undefined);
    return task;
  }

  async search(query: string, max: number): Promise<SearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const extracted = await this.run<ExtractedResults>(url, EXTRACT_RESULTS);
    if (extracted.blocked) {
      throw new Error(
        'The search engine asked for a verification instead of answering (too many requests from this machine). Try again in a while, or choose an online provider in the Web search settings.',
      );
    }
    return normalizeEmbeddedResults(extracted.results, max);
  }

  async read(url: string): Promise<PageText> {
    const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const page = await this.run<{ title: string; text: string }>(target, EXTRACT_TEXT);
    return { title: page.title, url: target, text: page.text };
  }

  dispose(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
