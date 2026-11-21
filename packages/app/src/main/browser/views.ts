/**
 * The pages of the built-in browser (task 10.1): one native view a tab, in a session made by the caller (no preload,
 * no permission), never with Node nor the window's bridge. The person's tabs are theirs; each conversation's agent
 * has one tab of its own (`agent:<conversation>`), made at its first page in its project's session, and works on
 * that one only — it never reads, pictures nor acts on a tab of the person's (the browser redo, step 2; Paul,
 * 2026-11-20). The pane shows the person's tabs and its conversation's agent tab; a conversation deleted or
 * archived takes its agent's tab with it.
 *
 * v0's traps, kept: a native view sits above the window's page — it is placed only where the pane says, and
 * taken off when its tab, its pane or the window's other pages hide it (a view placed with no rectangle covered
 * the whole window); a load that fails resolves with its error, so that the pane still knows where it is.
 * Only http and https are ever loaded, by the person, the agent or the page itself: never `bonaparte://`,
 * `javascript:` or `devtools:`. The agent may open this machine's own pages (a dev server), never the
 * network it is in. One `file:` only: a file of the conversation's folders the agent opened (the core checked
 * it), whose page loads from the folder of the perimeter that holds it, and from nowhere else of the disk.
 */

import { lookup } from 'node:dns/promises';
import { realpathSync } from 'node:fs';
import { isIP } from 'node:net';
import { isAbsolute, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isPublicAddress } from '@aparte/bonaparte-core';
import type { PickedElement } from '@aparte/bonaparte-shared';
import { partitionOf, type TabOwner } from './sessions.js';

/** Whose agent calls: its conversation, and the project the core knows it in. */
export interface AgentCaller {
  conversationId: string;
  projectId?: string;
}

const AGENT_TAB = 'agent:';
/** A conversation's agent's own tab. */
export const agentTabId = (conversationId: string): string => `${AGENT_TAB}${conversationId}`;
const NO_PAGE = 'No page is open in the browser: open one with browser_open.';

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
    /** Electron's id of the page: what the session's requests name. */
    readonly id: number;
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

/** The main window as the browser needs it: where its native views go. */
export interface MainWindowLike {
  isDestroyed(): boolean;
  contentView: { addChildView(view: unknown): void; removeChildView(view: unknown): void };
}

/**
 * The pages go on the main window's content view — never on one already destroyed: at `will-quit` the window is
 * gone, and Electron throws on it (review of phase 10).
 */
export function windowHost(window: () => MainWindowLike | undefined): BrowserHostWindow {
  const alive = (): MainWindowLike | undefined => {
    const win = window();
    return win && !win.isDestroyed() ? win : undefined;
  };
  const nativeOf = (view: PageView): unknown => (view as unknown as { native: unknown }).native;
  return {
    attach: (view) => alive()?.contentView.addChildView(nativeOf(view)),
    detach: (view) => alive()?.contentView.removeChildView(nativeOf(view)),
  };
}

/**
 * « L'agent lit la page »: on while the agent reads, and for `holdMs` after — a read takes milliseconds, and an
 * indicator that lasts that long is never seen (review of phase 10).
 */
export function readingSignal(changed: () => void, holdMs: number): { on(): boolean; during<T>(read: () => Promise<T>): Promise<T> } {
  let reads = 0;
  let held: ReturnType<typeof setTimeout> | null = null;
  return {
    on: () => reads > 0 || held !== null,
    async during(read) {
      const was = reads > 0 || held !== null;
      reads += 1;
      if (held) clearTimeout(held);
      held = null;
      if (!was) changed();
      try {
        return await read();
      } finally {
        reads -= 1;
        if (reads === 0) {
          held = setTimeout(() => {
            held = null;
            if (reads === 0) changed();
          }, holdMs);
          held.unref?.();
        }
      }
    },
  };
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
  /** The tab of the conversation's agent. */
  agent?: true;
  /** The agent's tab got a page the person has not seen yet: it waits behind their own tab (§3.3). */
  fresh?: true;
}

/** How a pane says where its tab goes, besides the rectangle. */
export interface PlaceOptions {
  /**
   * The tab has no page: nothing to attach, yet the pane is visible and the person looks at it — a blank « Nouvel
   * onglet » is theirs, never « covered » (third review of step 2).
   */
  blank?: boolean;
}

/**
 * What a page always confirms, whatever was remembered (audit 2026-11-21, D3), as the page itself can tell it:
 * a field for a password or a one-time code (its type, its autocomplete), one for a card (`cc-…`), a click that
 * sends a form (a submit button of a form, an image input), and one that opens a file chooser (a file input, or
 * its label). A script of the page that posts on any click, or a link to a file, cannot be told beforehand; the
 * agent's tab never downloads (its session refuses every download).
 */
const ALWAYS_ASKED = {
  password: 'types into a password field',
  payment: 'types into a payment card field',
  submit: 'sends a form',
  upload: 'chooses a file to upload',
} as const;
type AlwaysAsked = keyof typeof ALWAYS_ASKED;

type ActOutcome =
  | { kind: 'done'; done: string }
  | { kind: 'missing' }
  | { kind: 'moved'; origin: string }
  | { kind: 'always-asked'; what: AlwaysAsked; origin: string };

function readOutcome(raw: unknown): ActOutcome {
  if (raw === null || raw === undefined) return { kind: 'missing' };
  if (typeof raw !== 'object' || !('outcome' in raw)) return { kind: 'done', done: String(raw) };
  const said = raw as { outcome?: unknown; done?: unknown; origin?: unknown; what?: unknown };
  const origin = typeof said.origin === 'string' ? said.origin : '';
  if (said.outcome === 'missing') return { kind: 'missing' };
  if (said.outcome === 'moved') return { kind: 'moved', origin };
  if (said.outcome === 'always-asked' && typeof said.what === 'string' && said.what in ALWAYS_ASKED) {
    return { kind: 'always-asked', what: said.what as AlwaysAsked, origin };
  }
  return { kind: 'done', done: typeof said.done === 'string' ? said.done : 'done' };
}

/** The act, as one script of the page: its site checked, what it always confirms refused unless confirmed. */
export function actScript(action: AgentAction, origin: string | null, confirmed: boolean): string {
  const act =
    action.kind === 'scroll'
      ? `window.scrollBy(0, ${Number(action.by) || 0}); return { outcome: 'done', done: 'scrolled' };`
      : action.kind === 'click'
        ? 'element.click(); return { outcome: "done", done: "clicked" };'
        : `element.focus(); element.value = ${JSON.stringify(action.text)}; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return { outcome: 'done', done: 'typed' };`;
  return `(() => {
  const here = location.origin;
  const judged = ${JSON.stringify(origin)};
  if (judged !== null && here.toLowerCase() !== judged) return { outcome: 'moved', origin: here };
  ${action.kind === 'scroll' ? act : `const element = document.querySelector(${JSON.stringify(action.selector)});
  if (!element) return null;
  const confirmed = ${confirmed ? 'true' : 'false'};
  const kind = ${JSON.stringify(action.kind)};
  const alwaysAsked = (() => {
    const auto = String(element.getAttribute('autocomplete') || '').toLowerCase().split(' ');
    if (kind === 'type') {
      if (element instanceof HTMLInputElement && element.type === 'password') return 'password';
      if (auto.some((token) => token === 'current-password' || token === 'new-password' || token === 'one-time-code')) return 'password';
      if (auto.some((token) => token.startsWith('cc-'))) return 'payment';
      return null;
    }
    const file = element.closest('input[type="file"]') || (element.closest('label') && element.closest('label').control && element.closest('label').control.type === 'file' ? element.closest('label').control : null);
    if (file) return 'upload';
    const button = element.closest('button, input[type="submit"], input[type="image"]');
    if (button && button.form && (button.type === 'submit' || button.type === 'image')) return 'submit';
    return null;
  })();
  if (alwaysAsked && !confirmed) return { outcome: 'always-asked', what: alwaysAsked, origin: here };
  ${act}`}
})()`;
}

export type AgentAction = { kind: 'click'; selector: string } | { kind: 'type'; selector: string; text: string } | { kind: 'scroll'; by: number };

export interface BrowserViewsOptions {
  /** A tab's page, in its owner's session: the person's, or the agent's project's. */
  create(owner: TabOwner): PageView;
  host: BrowserHostWindow;
  /** A tab changed (its address, its title, its console): the pane reads the states again. */
  changed(): void;
  /** Tests only: how a host's addresses are found. */
  lookup?: (host: string) => Promise<string[]>;
  /**
   * How the pages' own network stack resolved a host, in a session (its partition) — Chromium's cache, stale
   * entries too: what the page really connected to, not a second answer of the name's server (audit 13.4).
   */
  pageLookup?: (host: string, partition: string) => Promise<string[]>;
}

const PHONE_WIDTH = 360;
const MAX_CONSOLE = 200;
const MAX_TEXT = 60_000;

interface Tab {
  id: string;
  view: PageView;
  /** The person's, or a conversation's agent's: what the agent may reach is checked in its tab, whoever drives it. */
  owner: TabOwner;
  /** The session it lives in. */
  partition: string;
  loading: boolean;
  error?: string;
  console: ConsoleLine[];
  /** A page the agent opened answered from the network this machine is in, by Chromium's own resolution (audit 13.4). */
  reachedPrivate?: boolean;
  /** A file the agent opened: the only folder of the disk its page loads from (real, its links resolved). */
  fileRoot?: string;
  /** Its page stays off the network: the conversation may not reach it without asking (review of 2026-11-20). */
  fileOffline?: boolean;
  /**
   * An agent's tab that got a page while the person looked at a tab of their own in its conversation's visible pane:
   * marked in the pane, behind theirs, until it is seen — and shown once that pane no longer shows the person's tab
   * (third review of step 2).
   */
  fresh?: boolean;
}

/**
 * A `file:` address that really lands inside `root` — its links and junctions resolved, as the perimeter is
 * (security rule 6): never `root`'s neighbours, never a path that climbs out of it, never a file that is not there.
 */
function fileIn(root: string | undefined, url: string): boolean {
  if (!root || !/^file:/i.test(url)) return false;
  let real: string;
  try {
    real = realpathSync.native(fileURLToPath(url));
  } catch {
    return false;
  }
  const inside = relative(root, real);
  return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside);
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

/** An address written as one, neither this machine nor the internet: the network this machine is in. */
const privateLiteral = (host: string): boolean => {
  const bare = host.replace(/^\[|\]$/g, '');
  return isIP(bare) !== 0 && !isLoopback(bare) && !isPublicAddress(bare);
};

const isAgentTab = (tab: Tab): boolean => tab.owner !== 'person';

const READ_PAGE = `(() => {
  const root = document.querySelector('article, main, [role="main"]') || document.body;
  return { title: document.title || '', text: root ? (root.innerText || '').slice(0, ${MAX_TEXT}) : '' };
})()`;

export class BrowserViews {
  private readonly tabs = new Map<string, Tab>();
  /**
   * The tab each conversation's pane shows (null: the pane of a conversation not made yet), set by that pane's
   * place and by its own agent's page — never inferred from what is attached, never another conversation's
   * (third review of step 2).
   */
  private readonly shownBy = new Map<string | null, string>();
  /**
   * The pane visible right now — its conversation and the tab it shows —; null when closed. Covered (a dialog,
   * Ctrl K, « À traiter », the settings), it is kept with `covered`: the person comes back to the same tab, so an
   * agent's page waiting behind it stays behind it (audit of 2026-11-21) — only the pane closed lets it go.
   */
  private visible: { conversationId: string | null; tabId: string; covered?: true } | null = null;
  /** What is attached to the window: only that. */
  private placed: Tab | null = null;
  private bounds: Rect | null = null;
  private readonly resolve: (host: string) => Promise<string[]>;

  constructor(private readonly options: BrowserViewsOptions) {
    this.resolve = options.lookup ?? (async (host) => (await lookup(host, { all: true })).map((found) => found.address));
  }

  /** A tab of the person's. An agent's tab is the agent's to make: never in its name. */
  openTab(tabId: string): void {
    if (tabId.startsWith(AGENT_TAB)) return;
    this.createTab(tabId, 'person');
    this.options.changed();
  }

  private createTab(tabId: string, owner: TabOwner): Tab {
    const existing = this.tabs.get(tabId);
    if (existing) return existing;
    const view = this.options.create(owner);
    const tab: Tab = { id: tabId, view, owner, partition: partitionOf(owner), loading: false, console: [] };
    // A page never opens a window of its own, nor goes where a person could not.
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const guard = (event: unknown, url: unknown): void => {
      // A file of the folder the agent's file was opened from; no other of the disk.
      if (typeof url === 'string' && /^file:/i.test(url)) {
        if (!fileIn(tab.fileRoot, url)) (event as { preventDefault(): void }).preventDefault();
      } else if (tab.fileOffline) {
        // A file's page kept off the network does not go there by a link either.
        (event as { preventDefault(): void }).preventDefault();
      } else if (typeof url !== 'string' || pageUrl(url) === null || !/^https?:/i.test(url)) (event as { preventDefault(): void }).preventDefault();
      // A page the agent opened does not take it into the network this machine is in (a redirect, a script).
      else if (isAgentTab(tab) && privateLiteral(new URL(url).hostname)) (event as { preventDefault(): void }).preventDefault();
    };
    view.webContents.on('will-navigate', guard);
    view.webContents.on('will-redirect', guard);
    view.webContents.on('console-message', (...args: unknown[]) => this.consoleLine(tab, args));
    view.webContents.on('did-navigate', () => this.options.changed());
    view.webContents.on('page-title-updated', () => this.options.changed());
    this.tabs.set(tabId, tab);
    return tab;
  }

  /** A conversation deleted or archived: its agent's tab goes with it (review of step 2). */
  closeAgentTab(conversationId: string): void {
    this.closeTab(agentTabId(conversationId));
    this.shownBy.delete(conversationId);
  }

  closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if (this.placed === tab) this.unplace();
    tab.view.webContents.close();
    this.tabs.delete(tabId);
    // Shown nowhere any more: each pane that showed it shows what it chooses next.
    for (const [conversation, shown] of this.shownBy) if (shown === tabId) this.shownBy.delete(conversation);
    if (this.visible?.tabId === tabId) this.visible = null;
    this.options.changed();
  }

  /**
   * Where a conversation's pane shows the tab (its conversation: null for one not made yet). A rectangle: the pane
   * is visible and the tab attached there. Null: covered or closed — unless `blank`, a tab with no page in a
   * visible pane, which has nothing to attach yet is what the person looks at. Only the tab placed is attached;
   * whatever was attached before it goes.
   */
  place(tabId: string, rect: Rect | null, device: Device, conversationId: string | null = null, options: PlaceOptions = {}): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    this.shownBy.set(conversationId, tabId);
    const hasRect = rect !== null && rect.width > 0 && rect.height > 0;
    if (!hasRect) this.unplace();
    if (!hasRect && !options.blank) {
      // Covered: nobody looks at this pane now, yet the person comes back to this tab when the cover goes.
      this.visible = { conversationId, tabId, covered: true };
      return;
    }
    this.visible = { conversationId, tabId };
    // Seen, an agent's new page is no longer marked.
    if (tab.fresh) {
      delete tab.fresh;
      this.options.changed();
    }
    if (!hasRect || !rect) return;
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
    this.visible = null;
  }

  async navigate(tabId: string, typed: string): Promise<{ url: string; title: string } | { error: string }> {
    const tab = this.tabs.get(tabId);
    if (!tab) return { error: 'There is no such tab.' };
    const url = pageUrl(typed);
    if (!url) return { error: 'Only http and https addresses are opened.' };
    // The agent's tab stays the agent's, whoever types in it: never the network this machine is in.
    if (isAgentTab(tab)) {
      const refused = await this.refusedForAgent(new URL(url).hostname);
      if (refused) return { error: refused };
      delete tab.reachedPrivate;
    }
    delete tab.fileRoot;
    delete tab.fileOffline;
    return this.load(tab, url);
  }

  back(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (tab?.view.webContents.canGoBack()) tab.view.webContents.goBack();
  }

  reload(tabId: string): void {
    this.tabs.get(tabId)?.view.webContents.reload();
  }

  /** The tabs a conversation's pane shows: the person's, and that conversation's agent's — no other agent's. */
  states(conversationId: string | null): BrowserTabState[] {
    return this.inScope(conversationId).map((tab) => ({
      tabId: tab.id,
      url: tab.view.webContents.getURL(),
      title: tab.view.webContents.getTitle(),
      canGoBack: tab.view.webContents.canGoBack(),
      loading: tab.loading,
      ...(tab.error ? { error: tab.error } : {}),
      errors: tab.console.filter((line) => line.level === 'error').length,
      warnings: tab.console.filter((line) => line.level === 'warning').length,
      ...(isAgentTab(tab) ? { agent: true as const } : {}),
      ...(tab.fresh ? { fresh: true as const } : {}),
    }));
  }

  /**
   * The tab a conversation's pane shows: the one it placed last or its agent's page, whichever came last — and its
   * agent's page not seen yet, once that pane no longer shows a tab of the person's to the person (closed, covered).
   */
  shownIn(conversationId: string | null): string | null {
    const own = conversationId === null ? undefined : this.tabs.get(agentTabId(conversationId));
    // A cover does not release a page that waits behind the person's tab: the pane closed does.
    if (own?.fresh && !this.looksAtOwnTab(conversationId, { orCovered: true })) return own.id;
    const shown = this.shownBy.get(conversationId);
    if (shown !== undefined && this.inScope(conversationId).some((tab) => tab.id === shown)) return shown;
    return own?.id ?? null;
  }

  /**
   * The person looks at a tab of their own in that conversation's pane, right now — a blank one included; with
   * `orCovered`, also while a page covers that pane (they come back to it).
   */
  private looksAtOwnTab(conversationId: string | null, { orCovered = false }: { orCovered?: boolean } = {}): boolean {
    if (!this.visible || this.visible.conversationId !== conversationId) return false;
    if (this.visible.covered && !orCovered) return false;
    const tab = this.tabs.get(this.visible.tabId);
    return tab !== undefined && !isAgentTab(tab);
  }

  private inScope(conversationId: string | null): Tab[] {
    const own = conversationId === null ? null : agentTabId(conversationId);
    return [...this.tabs.values()].filter((tab) => !isAgentTab(tab) || tab.id === own);
  }

  console(tabId: string): ConsoleLine[] {
    return [...(this.tabs.get(tabId)?.console ?? [])];
  }

  // ── The agent's side: its conversation's own tab, never another ──

  async agentOpen(typed: string, from: AgentCaller): Promise<{ url: string; title: string } | { error: string }> {
    const url = pageUrl(typed);
    if (!url) return { error: 'Only http and https addresses are opened.' };
    const refused = await this.refusedForAgent(new URL(url).hostname);
    if (refused) return { error: refused };
    const tab = this.agentTab(from);
    delete tab.reachedPrivate;
    delete tab.fileRoot;
    delete tab.fileOffline;
    return this.load(tab, url);
  }

  /**
   * A file the core checked (in the conversation's folders): its page loads from `root` alone (Paul, 2026-11-20),
   * and reaches the network only when the conversation may without asking — else nothing of it leaves the machine.
   */
  async agentOpenFile(path: string, root: string, options: { network: boolean } & AgentCaller): Promise<{ url: string; title: string } | { error: string }> {
    const tab = this.agentTab(options);
    delete tab.reachedPrivate;
    tab.fileRoot = root;
    if (options.network) delete tab.fileOffline;
    else tab.fileOffline = true;
    return this.load(tab, pathToFileURL(path).href);
  }

  /**
   * The session saw a response come from an address (task 10.1, audit 13.4): Chromium's own resolution, not Node's.
   * A page the agent opened that answered from the network this machine is in — a name that rebinds, a link, a
   * script — is never read, pictured nor acted on afterwards.
   */
  responded(webContentsId: number, ip: string | undefined): void {
    const tab = this.tabOf(webContentsId);
    if (!tab || !isAgentTab(tab) || !ip) return;
    const bare = ip.replace(/^\[|\]$/g, '');
    if (!isLoopback(bare) && !isPublicAddress(bare)) tab.reachedPrivate = true;
  }

  /**
   * A request of a page the agent opened to an address of the network this machine is in: cancelled — written as
   * one, or a name the pages' own resolver gives such an address (a link, an image, a websocket, a rebinding name).
   */
  async blocked(webContentsId: number, url: string): Promise<boolean> {
    const tab = this.tabOf(webContentsId);
    // A file: only one of the folder the agent's file was opened from, in that tab.
    if (/^file:/i.test(url)) return !fileIn(tab?.fileRoot, url);
    // A file's page kept off the network: nothing of it leaves the machine, this machine's own servers included.
    if (tab?.fileOffline) return true;
    if (!tab || !isAgentTab(tab)) return false;
    return this.reachesPrivate(url, tab.partition);
  }

  /**
   * A request no page names (a service worker's) in an agent's session (review of step 2): judged as a page the agent
   * opened — a private address written as one, or a name that session resolves to one —; never a file of the disk.
   */
  async blockedWithoutPage(url: string, partition: string): Promise<boolean> {
    if (/^file:/i.test(url)) return true;
    return this.reachesPrivate(url, partition);
  }

  /** A request to the network this machine is in: written as one, or a name the session's own resolver gives such. */
  private async reachesPrivate(url: string, partition: string): Promise<boolean> {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return false;
    }
    if (privateLiteral(host)) return true;
    const bare = host.replace(/^\[|\]$/g, '');
    if (isIP(bare) || bare === 'localhost' || !this.options.pageLookup) return false;
    const seen = await this.options.pageLookup(bare, partition).catch(() => []);
    return seen.some((address) => !isLoopback(address) && !isPublicAddress(address));
  }

  private tabOf(webContentsId: number): Tab | undefined {
    return [...this.tabs.values()].find((tab) => tab.view.webContents.id === webContentsId);
  }

  async agentRead(from: AgentCaller): Promise<{ url: string; title: string; text: string; console: ConsoleLine[] } | null> {
    const tab = this.ownTab(from);
    if (!tab || !tab.view.webContents.getURL()) return null;
    await this.mayReach(tab);
    const read = (await tab.view.webContents.executeJavaScript(READ_PAGE, true)) as { title: string; text: string };
    return { url: tab.view.webContents.getURL(), title: read.title, text: read.text, console: [...tab.console] };
  }

  async agentScreenshot(from: AgentCaller): Promise<{ url: string; png: Uint8Array; width: number; height: number } | null> {
    const tab = this.ownTab(from);
    if (!tab || !tab.view.webContents.getURL()) return null;
    await this.mayReach(tab);
    const image = await tab.view.webContents.capturePage();
    const size = image.getSize();
    return { url: tab.view.webContents.getURL(), png: image.toPNG(), width: size.width, height: size.height };
  }

  async agentAct(
    action: AgentAction,
    from: AgentCaller & { origin?: string; confirmed?: boolean },
  ): Promise<{ done: string; url?: string } | { error: string; url?: string }> {
    const tab = this.ownTab(from);
    if (!tab || !tab.view.webContents.getURL()) return { error: NO_PAGE };
    try {
      await this.mayReach(tab);
    } catch (error) {
      return { error: (error as Error).message };
    }
    // One script, one turn of the page: where it is, what the element is, and the act — nothing changes in between.
    // Selectors, text and the site reach the page as JSON: a quote cannot close the script's string.
    const raw = (await tab.view.webContents.executeJavaScript(actScript(action, from.origin ?? null, from.confirmed === true), true)) as unknown;
    const url = tab.view.webContents.getURL();
    const outcome = readOutcome(raw);
    switch (outcome.kind) {
      case 'done':
        return { done: outcome.done, url };
      case 'missing':
        return { error: `No element matches ${action.kind === 'scroll' ? '' : action.selector}.`, url };
      case 'moved':
        return {
          error: `Not done: the page is now at ${outcome.origin}, not at ${from.origin ?? ''} where this was judged. Read it again with browser_read, then act.`,
          url,
        };
      case 'always-asked':
        return { error: `Not done: this ${ALWAYS_ASKED[outcome.what]} on ${outcome.origin}. That is always asked of the user: call browser_act again with the same input and "confirm": true.`, url };
    }
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
  async pins(tabId: string, pins: readonly { n: number; x: number; y: number }[], accent: string, ink = 'currentColor'): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.view.webContents.getURL()) return;
    await tab.view.webContents.executeJavaScript(pinsScript(pins, accent, ink), true);
  }

  dispose(): void {
    this.unplace();
    for (const tab of this.tabs.values()) tab.view.webContents.close();
    this.tabs.clear();
  }

  /** The caller's own tab, when its agent opened one: never the person's, never another conversation's. */
  private ownTab(from: AgentCaller): Tab | undefined {
    return this.tabs.get(agentTabId(from.conversationId));
  }

  /**
   * The caller's own tab, made at its first page in its project's session — again when the conversation moved to
   * another project. Its conversation's pane shows it, unless that pane is visible right now and shows the person
   * a tab of their own (a blank « Nouvel onglet » too): then it waits behind theirs, marked (`fresh`, §3.3).
   * Another conversation's pane is never touched (third review of step 2).
   */
  private agentTab(from: AgentCaller): Tab {
    const id = agentTabId(from.conversationId);
    const owner: TabOwner = { conversationId: from.conversationId, ...(from.projectId ? { projectId: from.projectId } : {}) };
    const was = this.tabs.get(id);
    if (was && was.partition !== partitionOf(owner)) this.closeTab(id);
    const tab = this.createTab(id, owner);
    if (this.looksAtOwnTab(from.conversationId)) tab.fresh = true;
    else this.shownBy.set(from.conversationId, id);
    this.options.changed();
    return tab;
  }

  // ── End-to-end tests only: the person's own gestures in a page, which Playwright cannot reach (a native view) ──

  /** A click of the person's in a tab: the page's own `element.click()`. */
  async testClick(tabId: string, selector: string): Promise<boolean> {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.view.webContents.getURL()) return false;
    return (await tab.view.webContents.executeJavaScript(
      `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`,
      true,
    )) as boolean;
  }

  /** A picture of a tab: a native view is absent from a picture of the window. */
  async testCapture(tabId: string): Promise<{ png: Uint8Array; width: number; height: number } | null> {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.view.webContents.getURL()) return null;
    const image = await tab.view.webContents.capturePage();
    return { png: image.toPNG(), ...image.getSize() };
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

  /**
   * Where the agent's page has ended — after a redirect, a script, a link — is checked again before the agent
   * reads, pictures or acts on it: the first address was only where it started (review of phase 10).
   */
  private async mayReach(tab: Tab): Promise<void> {
    const shown = tab.view.webContents.getURL();
    if (/^file:/i.test(shown)) {
      if (fileIn(tab.fileRoot, shown)) return;
      throw new Error('Refused: this page is a file outside the folder the agent opened it from.');
    }
    const answered = 'Refused: this page answered from a private address (the network this machine is in). The browser opens the internet and this machine\'s own pages.';
    if (tab.reachedPrivate) throw new Error(answered);
    const host = new URL(tab.view.webContents.getURL()).hostname;
    const refused = await this.refusedForAgent(host);
    if (refused) throw new Error(refused);
    // What the page's own resolver holds for the name: a name that answered Node one address and Chromium another.
    const bare = host.replace(/^\[|\]$/g, '');
    if (this.options.pageLookup && !isIP(bare) && bare !== 'localhost') {
      const seen = await this.options.pageLookup(bare, tab.partition).catch(() => []);
      if (seen.some((address) => !isLoopback(address) && !isPublicAddress(address))) throw new Error(answered);
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

/** The pins in the window's colours: its accent, and the ink the kit puts on it — never a colour of ours. */
function pinsScript(pins: readonly { n: number; x: number; y: number }[], accent: string, ink: string): string {
  const shown = pins.map((pin) => ({ n: Math.round(pin.n), x: Math.round(pin.x), y: Math.round(pin.y) }));
  return `(() => {
  document.querySelectorAll('.__bonaparte-pin').forEach((pin) => pin.remove());
  for (const pin of ${JSON.stringify(shown)}) {
    const mark = document.createElement('div');
    mark.className = '__bonaparte-pin';
    mark.textContent = String(pin.n);
    mark.setAttribute('aria-label', 'Commentaire ' + pin.n);
    Object.assign(mark.style, { position: 'absolute', left: (pin.x - 11) + 'px', top: (pin.y - 11) + 'px', width: '22px', height: '22px', borderRadius: '11px', background: ${JSON.stringify(colourOf(accent))}, color: ${JSON.stringify(colourOf(ink))}, border: '2px solid ' + ${JSON.stringify(colourOf(ink))}, font: '600 12px/18px sans-serif', textAlign: 'center', zIndex: '2147483647', pointerEvents: 'none' });
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
