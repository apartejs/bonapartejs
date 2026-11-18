/**
 * The pages of the built-in browser (task 10.1): one native view a tab, in a session of its own (made by the
 * caller: no persistence, no preload, no permission), never with Node nor the window's bridge. The person's
 * gestures (tabs, address, back, reload, screen size) and the agent's tools (open, read, screenshot, act) work
 * on the same pages; the agent works on the tab shown, and opens one when none is.
 *
 * v0's traps, kept: a native view sits above the window's page — it is placed only where the pane says, and
 * taken off when its tab, its pane or the window's other pages hide it (a view placed with no rectangle covered
 * the whole window); a load that fails resolves with its error, so that the pane still knows where it is.
 * Only http and https are ever loaded, by the person, the agent or the page itself: never `bonaparte://`,
 * `file:`, `javascript:` or `devtools:`. The agent may open this machine's own pages (a dev server), never the
 * network it is in.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicAddress } from '@aparte/bonaparte-core';
import type { PickedElement } from '@aparte/bonaparte-shared';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of a WebContentsView it uses (a fake one in tests). */
export interface PageView {
  setBounds(rect: Rect): void;
  webContents: {
    loadURL(url: string): Promise<void>;
    getURL(): string;
    getTitle(): string;
    canGoBack(): boolean;
    goBack(): void;
    reload(): void;
    stop(): void;
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
    capturePage(): Promise<{ toPNG(): Uint8Array; getSize(): { width: number; height: number } }>;
    on(event: string, listener: (...args: unknown[]) => void): void;
    setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
    close(): void;
  };
}

export interface BrowserHostWindow {
  attach(view: PageView): void;
  detach(view: PageView): void;
}

export type Device = 'desktop' | 'phone';

export interface ConsoleLine {
  level: 'error' | 'warning' | 'info' | 'debug';
  text: string;
  source: string;
}

export interface BrowserTabState {
  tabId: string;
  url: string;
  title: string;
  canGoBack: boolean;
  loading: boolean;
  error?: string;
  errors: number;
  warnings: number;
}

export type AgentAction = { kind: 'click'; selector: string } | { kind: 'type'; selector: string; text: string } | { kind: 'scroll'; by: number };

export interface BrowserViewsOptions {
  create(): PageView;
  host: BrowserHostWindow;
  /** A tab changed (its address, its title, its console): the pane reads the states again. */
  changed(): void;
  /** Tests only: how a host's addresses are found. */
  lookup?: (host: string) => Promise<string[]>;
}

const PHONE_WIDTH = 360;
const MAX_CONSOLE = 200;
const MAX_TEXT = 60_000;

interface Tab {
  id: string;
  view: PageView;
  loading: boolean;
  error?: string;
  console: ConsoleLine[];
}

/** An address as a person types it: a scheme added when it has none; null for anything but http(s). */
export function pageUrl(typed: string): string | null {
  const text = typed.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^localhost:\d/i.test(text) && !/^[\d.]+:\d/.test(text) ? text : `http://${text}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const isLoopback = (address: string): boolean => /^127\./.test(address) || address === '::1' || address === '0:0:0:0:0:0:0:1';

const READ_PAGE = `(() => {
  const root = document.querySelector('article, main, [role="main"]') || document.body;
  return { title: document.title || '', text: root ? (root.innerText || '').slice(0, ${MAX_TEXT}) : '' };
})()`;

export class BrowserViews {
  private readonly tabs = new Map<string, Tab>();
  private shown: string | null = null;
  private placed: Tab | null = null;
  private bounds: Rect | null = null;
  private readonly resolve: (host: string) => Promise<string[]>;

  constructor(private readonly options: BrowserViewsOptions) {
    this.resolve = options.lookup ?? (async (host) => (await lookup(host, { all: true })).map((found) => found.address));
  }

  openTab(tabId: string): void {
    if (this.tabs.has(tabId)) return;
    const view = this.options.create();
    const tab: Tab = { id: tabId, view, loading: false, console: [] };
    // A page never opens a window of its own, nor goes where a person could not.
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const guard = (event: unknown, url: unknown): void => {
      if (typeof url !== 'string' || pageUrl(url) === null || !/^https?:/i.test(url)) (event as { preventDefault(): void }).preventDefault();
    };
    view.webContents.on('will-navigate', guard);
    view.webContents.on('will-redirect', guard);
    view.webContents.on('console-message', (...args: unknown[]) => this.consoleLine(tab, args));
    view.webContents.on('did-navigate', () => this.options.changed());
    view.webContents.on('page-title-updated', () => this.options.changed());
    this.tabs.set(tabId, tab);
    this.shown ??= tabId;
    this.options.changed();
  }

  closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if (this.placed === tab) this.unplace();
    tab.view.webContents.close();
    this.tabs.delete(tabId);
    if (this.shown === tabId) this.shown = [...this.tabs.keys()].at(-1) ?? null;
    this.options.changed();
  }

  /** Where the pane shows the tab; null: hidden. Only one tab is placed at a time — the one shown. */
  place(tabId: string, rect: Rect | null, device: Device): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    this.shown = tabId;
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      if (this.placed === tab) this.unplace();
      return;
    }
    if (this.placed && this.placed !== tab) this.unplace();
    const width = device === 'phone' ? Math.min(PHONE_WIDTH, rect.width) : rect.width;
    const bounds = { x: Math.round(rect.x + (rect.width - width) / 2), y: Math.round(rect.y), width: Math.round(width), height: Math.round(rect.height) };
    tab.view.setBounds(bounds);
    this.bounds = bounds;
    if (this.placed !== tab) {
      this.options.host.attach(tab.view);
      this.placed = tab;
    }
  }

  /** Where the tab shown is, when it is placed: what an end-to-end test reads. */
  placement(): { tabId: string; bounds: Rect } | null {
    return this.placed && this.bounds ? { tabId: this.placed.id, bounds: this.bounds } : null;
  }

  /** The pane closed, or a page went over it (« À traiter », the settings, a menu): no view stays on top. */
  hideAll(): void {
    this.unplace();
  }

  async navigate(tabId: string, typed: string): Promise<{ url: string; title: string } | { error: string }> {
    const tab = this.tabs.get(tabId);
    if (!tab) return { error: 'There is no such tab.' };
    const url = pageUrl(typed);
    if (!url) return { error: 'Only http and https addresses are opened.' };
    return this.load(tab, url);
  }

  back(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (tab?.view.webContents.canGoBack()) tab.view.webContents.goBack();
  }

  reload(tabId: string): void {
    this.tabs.get(tabId)?.view.webContents.reload();
  }

  states(): BrowserTabState[] {
    return [...this.tabs.values()].map((tab) => ({
      tabId: tab.id,
      url: tab.view.webContents.getURL(),
      title: tab.view.webContents.getTitle(),
      canGoBack: tab.view.webContents.canGoBack(),
      loading: tab.loading,
      ...(tab.error ? { error: tab.error } : {}),
      errors: tab.console.filter((line) => line.level === 'error').length,
      warnings: tab.console.filter((line) => line.level === 'warning').length,
    }));
  }

  console(tabId: string): ConsoleLine[] {
    return [...(this.tabs.get(tabId)?.console ?? [])];
  }

  // ── The agent's side: the tab shown, or one opened for it ──

  async agentOpen(typed: string): Promise<{ url: string; title: string } | { error: string }> {
    const url = pageUrl(typed);
    if (!url) return { error: 'Only http and https addresses are opened.' };
    const refused = await this.refusedForAgent(new URL(url).hostname);
    if (refused) return { error: refused };
    return this.load(this.agentTab(), url);
  }

  async agentRead(): Promise<{ url: string; title: string; text: string; console: ConsoleLine[] } | null> {
    const tab = this.shownTab();
    if (!tab || !tab.view.webContents.getURL()) return null;
    const read = (await tab.view.webContents.executeJavaScript(READ_PAGE, true)) as { title: string; text: string };
    return { url: tab.view.webContents.getURL(), title: read.title, text: read.text, console: [...tab.console] };
  }

  async agentScreenshot(): Promise<{ url: string; png: Uint8Array; width: number; height: number } | null> {
    const tab = this.shownTab();
    if (!tab || !tab.view.webContents.getURL()) return null;
    const image = await tab.view.webContents.capturePage();
    const size = image.getSize();
    return { url: tab.view.webContents.getURL(), png: image.toPNG(), width: size.width, height: size.height };
  }

  async agentAct(action: AgentAction): Promise<{ done: string } | { error: string }> {
    const tab = this.shownTab();
    if (!tab || !tab.view.webContents.getURL()) return { error: 'No page is open in the browser.' };
    // Selectors and text reach the page as JSON: a quote cannot close the script's string.
    const script =
      action.kind === 'scroll'
        ? `(() => { window.scrollBy(0, ${Number(action.by) || 0}); return 'scrolled'; })()`
        : `(() => {
  const element = document.querySelector(${JSON.stringify(action.selector)});
  if (!element) return null;
  ${action.kind === 'click' ? 'element.click(); return "clicked";' : `element.focus(); element.value = ${JSON.stringify(action.text)}; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return 'typed';`}
})()`;
    const done = (await tab.view.webContents.executeJavaScript(script, true)) as string | null;
    if (done === null) return { error: `No element matches ${action.kind === 'scroll' ? '' : action.selector}.` };
    return { done: String(done) };
  }

  // ── The person's tools (task 10.2): an element shown, pins on the page ──

  /**
   * « Sélectionner un élément » or « Commenter la page »: the page outlines what the pointer is over, in the
   * app's accent, and the element clicked is given back — its selector, where it sits, its text, size, font and
   * colour; null when the person leaves (Échap, or the tool switched off).
   */
  async pick(tabId: string, accent: string): Promise<PickedElement | null> {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.view.webContents.getURL()) return null;
    return (await tab.view.webContents.executeJavaScript(pickScript(accent), true)) as PickedElement | null;
  }

  async cancelPick(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.view.webContents.getURL()) return;
    await tab.view.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`, true);
  }

  /** The comments' pins, numbered, where they were placed; none: the pins taken off. */
  async pins(tabId: string, pins: readonly { n: number; x: number; y: number }[], accent: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.view.webContents.getURL()) return;
    await tab.view.webContents.executeJavaScript(pinsScript(pins, accent), true);
  }

  dispose(): void {
    this.unplace();
    for (const tab of this.tabs.values()) tab.view.webContents.close();
    this.tabs.clear();
  }

  private shownTab(): Tab | undefined {
    return this.shown ? this.tabs.get(this.shown) : undefined;
  }

  private agentTab(): Tab {
    const shown = this.shownTab();
    if (shown) return shown;
    const id = `agent-${this.tabs.size + 1}`;
    this.openTab(id);
    return this.tabs.get(id)!;
  }

  private async load(tab: Tab, url: string): Promise<{ url: string; title: string } | { error: string }> {
    tab.loading = true;
    delete tab.error;
    tab.console = [];
    this.options.changed();
    try {
      await tab.view.webContents.loadURL(url);
      return { url: tab.view.webContents.getURL(), title: tab.view.webContents.getTitle() };
    } catch (error) {
      tab.error = error instanceof Error ? error.message : String(error);
      return { error: tab.error };
    } finally {
      tab.loading = false;
      this.options.changed();
    }
  }

  /** This machine's own pages pass (a dev server); the network it is in does not. */
  private async refusedForAgent(host: string): Promise<string | null> {
    const bare = host.replace(/^\[|\]$/g, '');
    if (bare === 'localhost') return null;
    const addresses = isIP(bare) ? [bare] : await this.resolve(bare).catch(() => []);
    if (addresses.length === 0) return `The address ${host} cannot be resolved.`;
    const ok = addresses.every((address) => isLoopback(address) || isPublicAddress(address));
    return ok ? null : `Refused: ${host} is a private address (the network this machine is in). The browser opens the internet and this machine's own pages.`;
  }

  private unplace(): void {
    if (!this.placed) return;
    this.options.host.detach(this.placed.view);
    this.placed = null;
    this.bounds = null;
  }

  private consoleLine(tab: Tab, args: unknown[]): void {
    // Electron's newer event carries one object; the older one, (event, level, message, line, source).
    const [first, ...rest] = args;
    const said = first as { level?: unknown; message?: unknown; lineNumber?: unknown; sourceId?: unknown } | undefined;
    let level: ConsoleLine['level'];
    let text: string;
    let source: string;
    if (said && typeof said.message === 'string') {
      level = levelOf(said.level);
      text = said.message;
      source = `${String(said.sourceId ?? '')}:${String(said.lineNumber ?? '')}`;
    } else {
      level = levelOf(rest[0]);
      text = String(rest[1] ?? '');
      source = `${String(rest[3] ?? '')}:${String(rest[2] ?? '')}`;
    }
    // Electron's own advice to the app (an unpackaged build's), not something the page said.
    if (text.startsWith('Electron Security Warning')) return;
    tab.console.push({ level, text, source });
    if (tab.console.length > MAX_CONSOLE) tab.console.splice(0, tab.console.length - MAX_CONSOLE);
    this.options.changed();
  }
}

export type { PickedElement };

/** The colour the window gives (its accent), checked to be one: it reaches the page's style. */
const colourOf = (accent: string): string => (/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|color\(srgb[\d\s.%/]+\))$/i.test(accent.trim()) ? accent.trim() : 'currentColor');

function pickScript(accent: string): string {
  return `new Promise((resolve) => {
  const style = document.createElement('style');
  style.textContent = '.__bonaparte-hover { outline: 2px dashed ' + ${JSON.stringify(colourOf(accent))} + ' !important; outline-offset: 2px !important; cursor: crosshair !important; }';
  document.head.appendChild(style);
  let last = null;
  const selectorOf = (el) => {
    if (el.id) return '#' + el.id;
    const classes = [...el.classList].filter((name) => !name.startsWith('__bonaparte')).slice(0, 2);
    return el.tagName.toLowerCase() + classes.map((name) => '.' + name).join('');
  };
  const pathOf = (el) => {
    const parts = [];
    for (let node = el.parentElement; node && node !== document.body && parts.length < 4; node = node.parentElement) {
      const index = node.parentElement ? [...node.parentElement.children].indexOf(node) + 1 : 1;
      parts.unshift(node.tagName.toLowerCase() + (node.tagName === 'TR' || node.tagName === 'LI' ? ':nth-child(' + index + ')' : ''));
    }
    return parts.join(' › ');
  };
  const over = (event) => {
    if (last) last.classList.remove('__bonaparte-hover');
    last = event.target;
    last.classList.add('__bonaparte-hover');
  };
  const done = (value) => {
    document.removeEventListener('mouseover', over, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key, true);
    if (last) last.classList.remove('__bonaparte-hover');
    style.remove();
    resolve(value);
  };
  const click = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const el = event.target;
    const box = el.getBoundingClientRect();
    const seen = getComputedStyle(el);
    done({
      selector: selectorOf(el),
      path: pathOf(el),
      text: (el.innerText || el.value || '').trim().slice(0, 200),
      width: Math.round(box.width),
      height: Math.round(box.height),
      fontSize: Math.round(parseFloat(seen.fontSize) || 0),
      bold: Number(seen.fontWeight) >= 600,
      color: seen.color,
      x: Math.round(box.left + window.scrollX + box.width / 2),
      y: Math.round(box.top + window.scrollY),
    });
  };
  const key = (event) => { if (event.key === 'Escape') done(null); };
  document.addEventListener('mouseover', over, true);
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', key, true);
})`;
}

function pinsScript(pins: readonly { n: number; x: number; y: number }[], accent: string): string {
  const shown = pins.map((pin) => ({ n: Math.round(pin.n), x: Math.round(pin.x), y: Math.round(pin.y) }));
  return `(() => {
  document.querySelectorAll('.__bonaparte-pin').forEach((pin) => pin.remove());
  for (const pin of ${JSON.stringify(shown)}) {
    const mark = document.createElement('div');
    mark.className = '__bonaparte-pin';
    mark.textContent = String(pin.n);
    mark.setAttribute('aria-label', 'Commentaire ' + pin.n);
    Object.assign(mark.style, { position: 'absolute', left: (pin.x - 11) + 'px', top: (pin.y - 11) + 'px', width: '22px', height: '22px', borderRadius: '11px', background: ${JSON.stringify(colourOf(accent))}, color: 'white', border: '2px solid white', font: '600 12px/18px sans-serif', textAlign: 'center', zIndex: '2147483647', pointerEvents: 'none' });
    document.body.appendChild(mark);
  }
  return true;
})()`;
}

function levelOf(level: unknown): ConsoleLine['level'] {
  if (level === 'error' || level === 3) return 'error';
  if (level === 'warning' || level === 'warn' || level === 2) return 'warning';
  if (level === 'debug' || level === 0) return 'debug';
  return 'info';
}
