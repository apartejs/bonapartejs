/**
 * The pages of the built-in browser (task 10.1), with views that record what is done to them: no Electron.
 * A page is placed only where the pane says, and taken off when its tab or the pane is hidden — a native view
 * sits above the window's page; only http(s) is ever loaded; the agent works on the tab shown.
 */

import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BrowserViews, readingSignal, windowHost, type PageView } from './views.js';

interface FakeView extends PageView {
  loaded: string[];
  bounds: { x: number; y: number; width: number; height: number } | null;
  scripts: string[];
  emit(event: string, ...args: unknown[]): void;
  prevented: string[];
}

let nextId = 1;

function fakeView(page: { title?: string; read?: unknown; failLoad?: boolean; redirectTo?: string } = {}): FakeView {
  const id = nextId++;
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  let url = '';
  const view: FakeView = {
    loaded: [],
    bounds: null,
    scripts: [],
    prevented: [],
    emit: (event, ...args) => listeners.get(event)?.forEach((listener) => listener(...args)),
    setBounds: (rect) => void (view.bounds = rect),
    webContents: {
      id,
      loadURL: async (target) => {
        view.loaded.push(target);
        // A server that answers with a redirect: the page ends where it says.
        url = page.redirectTo ?? target;
        if (page.failLoad) throw new Error('ERR_CONNECTION_REFUSED');
      },
      getURL: () => url,
      getTitle: () => page.title ?? 'Page',
      canGoBack: () => view.loaded.length > 1,
      goBack: () => undefined,
      reload: () => undefined,
      stop: () => undefined,
      executeJavaScript: async (code) => {
        view.scripts.push(code);
        return page.read ?? { title: page.title ?? 'Page', text: 'Hello' };
      },
      capturePage: async () => ({ toPNG: () => new Uint8Array([1, 2, 3]), getSize: () => ({ width: 800, height: 600 }) }),
      on: (event, listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
      setWindowOpenHandler: () => undefined,
      close: () => undefined,
    },
  };
  return view;
}

function rig(page: Parameters<typeof fakeView>[0] = {}) {
  const views: FakeView[] = [];
  const attached = new Set<FakeView>();
  const changes: number[] = [];
  const browser = new BrowserViews({
    create: () => {
      const view = fakeView(page);
      views.push(view);
      return view;
    },
    host: { attach: (view) => void attached.add(view as FakeView), detach: (view) => void attached.delete(view as FakeView) },
    changed: () => changes.push(1),
  });
  return { browser, views, attached, changes };
}

const RECT = { x: 400, y: 100, width: 800, height: 600 };

describe('the built-in browser’s pages (task 10.1)', () => {
  it('a tab is placed only once the pane says where, and taken off when hidden — a native view covers the page', async () => {
    const { browser, views, attached } = rig();
    browser.openTab('t1');
    expect(attached.size).toBe(0);
    browser.place('t1', RECT, 'desktop');
    expect(attached.has(views[0]!)).toBe(true);
    expect(views[0]!.bounds).toEqual(RECT);
    browser.place('t1', null, 'desktop');
    expect(attached.size).toBe(0);
    browser.place('t1', RECT, 'desktop');
    browser.hideAll();
    expect(attached.size).toBe(0);
  });

  it('only the tab shown is placed: another tab placed takes its place', () => {
    const { browser, views, attached } = rig();
    browser.openTab('t1');
    browser.openTab('t2');
    browser.place('t1', RECT, 'desktop');
    browser.place('t2', RECT, 'desktop');
    expect([...attached]).toEqual([views[1]]);
  });

  it('« Téléphone »: the page is 360 px wide, in the middle of the pane', () => {
    const { browser, views } = rig();
    browser.openTab('t1');
    browser.place('t1', RECT, 'phone');
    expect(views[0]!.bounds).toEqual({ x: 400 + (800 - 360) / 2, y: 100, width: 360, height: 600 });
  });

  it('only http and https are loaded: never bonaparte://, file:, javascript: nor devtools:', async () => {
    const { browser, views } = rig();
    browser.openTab('t1');
    for (const url of ['bonaparte://app/', 'file:///C:/Windows/win.ini', 'javascript:alert(1)', 'devtools://devtools/']) {
      expect(await browser.navigate('t1', url)).toMatchObject({ error: expect.stringMatching(/http/) });
    }
    expect(views[0]!.loaded).toEqual([]);
    expect(await browser.navigate('t1', 'localhost:5173')).toMatchObject({ url: 'http://localhost:5173/' });
    expect(views[0]!.loaded).toEqual(['http://localhost:5173/']);
  });

  it('a page cannot go itself where a person could not: its navigations are checked too', () => {
    const { browser, views } = rig();
    browser.openTab('t1');
    let prevented = false;
    views[0]!.emit('will-navigate', { preventDefault: () => (prevented = true) }, 'bonaparte://app/agent');
    expect(prevented).toBe(true);
  });

  it('a load that fails resolves with its error: the pane still places the tab and says it', async () => {
    const { browser } = rig({ failLoad: true });
    browser.openTab('t1');
    expect(await browser.navigate('t1', 'http://localhost:9')).toMatchObject({ error: expect.stringMatching(/REFUSED/) });
    expect(browser.states()[0]).toMatchObject({ tabId: 't1', error: expect.stringMatching(/REFUSED/) });
  });

  it('the console is kept, counted: errors and warnings', () => {
    const { browser, views } = rig();
    browser.openTab('t1');
    views[0]!.emit('console-message', { level: 'error', message: 'TypeError: x', lineNumber: 42, sourceId: 'weekly.ts' });
    views[0]!.emit('console-message', { level: 'warning', message: 'no alt', lineNumber: 1, sourceId: 'a.ts' });
    views[0]!.emit('console-message', { level: 'info', message: 'ready', lineNumber: 1, sourceId: 'a.ts' });
    expect(browser.states()[0]).toMatchObject({ errors: 1, warnings: 1 });
    expect(browser.console('t1')).toEqual([
      { level: 'error', text: 'TypeError: x', source: 'weekly.ts:42' },
      { level: 'warning', text: 'no alt', source: 'a.ts:1' },
      { level: 'info', text: 'ready', source: 'a.ts:1' },
    ]);
  });

  it('the agent opens, reads and acts on the tab shown; with none open, it opens one for it', async () => {
    const { browser, views } = rig({ title: 'Récap', read: { title: 'Récap', text: 'Total 7 h 15' } });
    expect(await browser.agentOpen('http://localhost:5173/rapport')).toMatchObject({ url: 'http://localhost:5173/rapport', title: 'Récap' });
    expect(views).toHaveLength(1);
    expect(await browser.agentRead()).toMatchObject({ url: 'http://localhost:5173/rapport', text: 'Total 7 h 15' });
    await browser.agentAct({ kind: 'click', selector: 'button.export"]' });
    // The selector reaches the page as JSON: a quote cannot close the script's string.
    expect(views[0]!.scripts.at(-1)).toContain(JSON.stringify('button.export"]'));
  });

  it('the agent may open this machine’s own pages (a dev server), never the network it is in', async () => {
    const { browser } = rig();
    expect(await browser.agentOpen('http://192.168.1.10/admin')).toMatchObject({ error: expect.stringMatching(/private/) });
    expect(await browser.agentOpen('http://127.0.0.1:3000/')).toMatchObject({ url: 'http://127.0.0.1:3000/' });
  });

  it('a screenshot of the tab shown: its size, the image kept for the window', async () => {
    const { browser } = rig();
    await browser.agentOpen('http://localhost:5173/');
    expect(await browser.agentScreenshot()).toMatchObject({ width: 800, height: 600, png: new Uint8Array([1, 2, 3]) });
  });
});

describe('the person’s tools on a page (task 10.2)', () => {
  it('Electron’s own warnings are not the page’s: they are neither counted nor listed', () => {
    const { browser, views } = rig();
    browser.openTab('t1');
    views[0]!.emit('console-message', { level: 'warning', message: 'Electron Security Warning (Insecure Content-Security-Policy) This renderer…', lineNumber: 0, sourceId: 'x' });
    views[0]!.emit('console-message', { level: 'warning', message: 'no alt', lineNumber: 1, sourceId: 'a.ts' });
    expect(browser.states()[0]).toMatchObject({ warnings: 1 });
    expect(browser.console('t1').map((line) => line.text)).toEqual(['no alt']);
  });


  const PICKED = { selector: 'td.num', path: 'table › tbody › tr:nth-child(1)', text: '7 h 15', width: 64, height: 32, fontSize: 14, bold: true, color: 'rgb(29, 29, 27)', x: 120, y: 80 };

  it('« Sélectionner un élément » gives back what the page says of the element clicked, outlined in the accent', async () => {
    const { browser, views } = rig({ read: PICKED });
    await browser.agentOpen('http://localhost:5173/');
    expect(await browser.pick(browser.states()[0]!.tabId, '#087ea4')).toEqual(PICKED);
    expect(views[0]!.scripts.at(-1)).toContain('#087ea4');
  });

  it('a colour that is not one never reaches the page’s style', async () => {
    const { browser, views } = rig({ read: null });
    await browser.agentOpen('http://localhost:5173/');
    const tabId = browser.states()[0]!.tabId;
    await browser.pick(tabId, "red; } body { display: none } .x { color: red");
    expect(views[0]!.scripts.at(-1)).not.toContain('display: none');
    await browser.pins(tabId, [{ n: 1, x: 10, y: 20 }], "red'); alert('x", "#fff'); alert('y");
    expect(views[0]!.scripts.at(-1)).not.toContain("alert('y");
    expect(views[0]!.scripts.at(-1)).not.toContain('alert');
  });

  it('a tab with no page picks nothing, and runs nothing in it', async () => {
    const { browser, views } = rig();
    browser.openTab('t1');
    expect(await browser.pick('t1', '#087ea4')).toBeNull();
    expect(views[0]!.scripts).toEqual([]);
  });

  it('the pins are drawn numbered, where they were placed; « Échap » leaves the picker', async () => {
    const { browser, views } = rig({ read: true });
    await browser.agentOpen('http://localhost:5173/');
    const tabId = browser.states()[0]!.tabId;
    await browser.pins(tabId, [{ n: 1, x: 10.4, y: 20.6 }, { n: 2, x: 300, y: 40 }], '#087ea4', 'rgb(255, 255, 255)');
    // Its ink is the one the window gives, never a colour written here.
    expect(views[0]!.scripts.at(-1)).toContain('rgb(255, 255, 255)');
    expect(views[0]!.scripts.at(-1)).not.toMatch(/'white'/);
    expect(views[0]!.scripts.at(-1)).toContain(JSON.stringify([{ n: 1, x: 10, y: 21 }, { n: 2, x: 300, y: 40 }]));
    await browser.cancelPick(tabId);
    expect(views[0]!.scripts.at(-1)).toContain('Escape');
  });
});

describe('the browser and the main window (review of phase 10)', () => {
  function window(destroyed: boolean) {
    const added: unknown[] = [];
    const removed: unknown[] = [];
    const contentView = {
      addChildView: (view: unknown) => {
        if (destroyed) throw new Error('Object has been destroyed');
        added.push(view);
      },
      removeChildView: (view: unknown) => {
        if (destroyed) throw new Error('Object has been destroyed');
        removed.push(view);
      },
    };
    return { win: { isDestroyed: () => destroyed, contentView }, added, removed };
  }

  it('places a page on the window, and takes it off', () => {
    const { win, added, removed } = window(false);
    const host = windowHost(() => win);
    const page = { native: 'view' } as unknown as PageView;
    host.attach(page);
    host.detach(page);
    expect(added).toEqual(['view']);
    expect(removed).toEqual(['view']);
  });

  it('a window already destroyed (the app quitting) is left alone: nothing throws', () => {
    const { win } = window(true);
    const host = windowHost(() => win);
    const page = { native: 'view' } as unknown as PageView;
    expect(() => host.detach(page)).not.toThrow();
    expect(() => host.attach(page)).not.toThrow();
  });
});

describe('« L’agent lit la page » (review of phase 10)', () => {
  it('is shown while the agent reads, and for a moment after, so that the person sees it', async () => {
    vi.useFakeTimers();
    try {
      const changes: number[] = [];
      const reading = readingSignal(() => changes.push(1), 1500);
      expect(reading.on()).toBe(false);
      const read = reading.during(async () => 'text');
      expect(reading.on()).toBe(true);
      expect(await read).toBe('text');
      // A read takes milliseconds: the indicator stays a moment longer.
      expect(reading.on()).toBe(true);
      vi.advanceTimersByTime(1499);
      expect(reading.on()).toBe(true);
      vi.advanceTimersByTime(1);
      expect(reading.on()).toBe(false);
      expect(changes.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the network this machine is in, after a redirect (review of phase 10)', () => {
  it('a page the agent opened that ends on a private address is neither read, nor pictured, nor acted on', async () => {
    const { browser } = rig({ redirectTo: 'http://192.168.1.1/admin', read: { title: 'Routeur', text: 'admin password' } });
    expect(await browser.agentOpen('http://93.184.216.34/')).toMatchObject({ url: 'http://192.168.1.1/admin' });
    await expect(browser.agentRead()).rejects.toThrow(/private address/);
    await expect(browser.agentScreenshot()).rejects.toThrow(/private address/);
    expect(await browser.agentAct({ kind: 'click', selector: 'button' })).toMatchObject({ error: expect.stringMatching(/private address/) });
  });

  it('a page the agent opened is not redirected into that network; the person’s page may go there', async () => {
    const { browser, views } = rig();
    await browser.agentOpen('http://93.184.216.34/');
    const redirect = (to: string): boolean => {
      let prevented = false;
      views[0]!.emit('will-redirect', { preventDefault: () => (prevented = true) }, to);
      return prevented;
    };
    expect(redirect('http://10.0.0.1/')).toBe(true);
    expect(redirect('http://127.0.0.1:5173/')).toBe(false);
    expect(redirect('https://93.184.216.35/')).toBe(false);
    await browser.navigate(browser.states()[0]!.tabId, 'http://93.184.216.34/');
    expect(redirect('http://10.0.0.1/')).toBe(false);
  });

  it('a page the person opened there is theirs to show the agent', async () => {
    const { browser } = rig({ read: { title: 'Routeur', text: 'status' } });
    browser.openTab('t1');
    await browser.navigate('t1', 'http://192.168.1.1/');
    expect(await browser.agentRead()).toMatchObject({ text: 'status' });
  });
});

describe('where Chromium connected decides, not a second lookup (audit 13.4: DNS rebinding)', () => {
  it('a page the agent opened that answered from the network this machine is in is never read, pictured nor acted on', async () => {
    const views: FakeView[] = [];
    const watched = new BrowserViews({
      create: () => {
        const view = fakeView();
        views.push(view);
        return view;
      },
      host: { attach: () => undefined, detach: () => undefined },
      changed: () => undefined,
      lookup: async () => ['93.184.216.34'],
    });
    expect(await watched.agentOpen('http://rebind.example/')).toMatchObject({ url: 'http://rebind.example/' });
    // The name answered a public address to Node, then a private one to Chromium.
    watched.responded(views[0]!.webContents.id, '192.168.1.1');
    await expect(watched.agentRead()).rejects.toThrow(/private/);
    // A new page the agent opens starts clean.
    expect(await watched.agentOpen('http://other.example/')).toMatchObject({ url: 'http://other.example/' });
    watched.responded(views[0]!.webContents.id, '93.184.216.34');
    await expect(watched.agentRead()).resolves.toMatchObject({ url: 'http://other.example/' });
  });

  it('a request of an agent’s page to a NAME of the network this machine is in is cancelled too (audit 13.4, second pass)', async () => {
    const views: FakeView[] = [];
    const browser = new BrowserViews({
      create: () => {
        const view = fakeView();
        views.push(view);
        return view;
      },
      host: { attach: () => undefined, detach: () => undefined },
      changed: () => undefined,
      lookup: async () => ['93.184.216.34'],
      pageLookup: async (host) => (host === 'router.lan' ? ['192.168.1.1'] : host === 'dev.local' ? ['127.0.0.1'] : ['93.184.216.34']),
    });
    await browser.agentOpen('http://public.example/');
    const id = views[0]!.webContents.id;
    expect(await browser.blocked(id, 'http://router.lan/apply.cgi')).toBe(true);
    expect(await browser.blocked(id, 'ws://router.lan:8123/api/websocket')).toBe(true);
    expect(await browser.blocked(id, 'http://dev.local:3000/')).toBe(false);
    expect(await browser.blocked(id, 'https://cdn.example/x.js')).toBe(false);
  });

  it('a page the person loaded becomes the agent’s once the agent acts on it: where it then goes is checked', async () => {
    const views: FakeView[] = [];
    const browser = new BrowserViews({
      create: () => {
        const view = fakeView();
        views.push(view);
        return view;
      },
      host: { attach: () => undefined, detach: () => undefined },
      changed: () => undefined,
      lookup: async () => ['93.184.216.34'],
    });
    browser.openTab('t1');
    await browser.navigate('t1', 'https://forum.example/');
    await browser.agentAct({ kind: 'click', selector: 'a' });
    expect(await browser.blocked(views[0]!.webContents.id, 'http://192.168.1.1/')).toBe(true);
  });

  it('a page of the network this machine is in that the person showed stays theirs when the agent acts on it (review of phase 13)', async () => {
    const views: FakeView[] = [];
    const browser = new BrowserViews({
      create: () => {
        const view = fakeView();
        views.push(view);
        return view;
      },
      host: { attach: () => undefined, detach: () => undefined },
      changed: () => undefined,
      lookup: async () => ['93.184.216.34'],
    });
    browser.openTab('t1');
    await browser.navigate('t1', 'http://192.168.1.50/admin');
    await browser.agentAct({ kind: 'click', selector: 'button' });
    expect(await browser.blocked(views[0]!.webContents.id, 'http://192.168.1.50/api/save')).toBe(false);
  });

  it('a name Chromium resolved to a private address is refused, whatever Node answers', async () => {
    const views: FakeView[] = [];
    const browser = new BrowserViews({
      create: () => {
        const view = fakeView();
        views.push(view);
        return view;
      },
      host: { attach: () => undefined, detach: () => undefined },
      changed: () => undefined,
      lookup: async () => ['93.184.216.34'],
      pageLookup: async () => ['10.0.0.7'],
    });
    await browser.agentOpen('http://rebind.example/');
    await expect(browser.agentRead()).rejects.toThrow(/private/);
  });

  it('a request of an agent’s page to a private address written as one is cancelled; a person’s page is theirs', async () => {
    const views: FakeView[] = [];
    const browser = new BrowserViews({
      create: () => {
        const view = fakeView();
        views.push(view);
        return view;
      },
      host: { attach: () => undefined, detach: () => undefined },
      changed: () => undefined,
      lookup: async () => ['93.184.216.34'],
    });
    await browser.agentOpen('http://public.example/');
    const id = views[0]!.webContents.id;
    expect(await browser.blocked(id, 'http://10.0.0.5/router.cgi')).toBe(true);
    expect(await browser.blocked(id, 'http://[fd00::1]/')).toBe(true);
    expect(await browser.blocked(id, 'http://127.0.0.1:5173/')).toBe(false);
    expect(await browser.blocked(id, 'https://cdn.example/x.js')).toBe(false);
    expect(await browser.blocked(9999, 'http://10.0.0.5/')).toBe(false);
  });
});

describe('a file of the conversation’s folders, opened by the agent (Paul, 2026-11-20)', () => {
  let root = '';
  let page = '';
  let elsewhere = '';
  let outside = '';
  beforeAll(async () => {
    // Real folders: where a file: address really lands is what is judged, its links resolved.
    root = realpathSync.native(await mkdtemp(join(tmpdir(), 'bp-projet-')));
    outside = realpathSync.native(await mkdtemp(join(tmpdir(), 'bp-ailleurs-')));
    await mkdir(join(root, 'bac'));
    page = join(root, 'bac', 'snake3.html');
    await writeFile(page, '<title>Snake</title>');
    await writeFile(join(root, 'bac', 'snake.js'), '');
    await writeFile(join(root, 'bac', 'level2.html'), '');
    await writeFile(join(outside, 'secret.html'), 'no');
    elsewhere = pathToFileURL(join(outside, 'secret.html')).href;
    // A link inside the project to a folder outside it (a junction on Windows: no right needed).
    await symlink(outside, join(root, 'docs'), process.platform === 'win32' ? 'junction' : 'dir');
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('loads the file, and the agent reads it', async () => {
    const { browser, views } = rig({ title: 'Snake', read: { title: 'Snake', text: 'Score: 0' } });
    expect(await browser.agentOpenFile(page, root, { network: false })).toMatchObject({ url: pathToFileURL(page).href, title: 'Snake' });
    expect(views[0]!.loaded).toEqual([pathToFileURL(page).href]);
    expect(await browser.agentRead()).toMatchObject({ text: 'Score: 0' });
  });

  it('its page loads from its folder only: the rest of the disk is cancelled, and so is a file in any other tab', async () => {
    const { browser, views } = rig();
    await browser.agentOpenFile(page, root, { network: true });
    const id = views[0]!.webContents.id;
    expect(await browser.blocked(id, pathToFileURL(join(root, 'bac', 'snake.js')).href)).toBe(false);
    expect(await browser.blocked(id, elsewhere)).toBe(true);
    // A file that is not there loads nothing either.
    expect(await browser.blocked(id, pathToFileURL(join(root, 'bac', 'none.js')).href)).toBe(true);
    // A page the person opened, or a page of the agent's once it went to the internet, loads no file.
    browser.openTab('t2');
    await browser.navigate('t2', 'http://localhost:5173/');
    expect(await browser.blocked(views[1]!.webContents.id, pathToFileURL(page).href)).toBe(true);
    await browser.agentOpen('http://localhost:5173/');
    expect(await browser.blocked(views[1]!.webContents.id, pathToFileURL(page).href)).toBe(true);
  });

  it('a link of the project that leads out of it is judged where it leads: cancelled (security rule 6, review of 2026-11-20)', async () => {
    const { browser, views } = rig();
    await browser.agentOpenFile(page, root, { network: false });
    const through = pathToFileURL(join(root, 'docs', 'secret.html')).href;
    expect(await browser.blocked(views[0]!.webContents.id, through)).toBe(true);
    let prevented = false;
    views[0]!.emit('will-navigate', { preventDefault: () => (prevented = true) }, through);
    expect(prevented).toBe(true);
  });

  it('its page reaches the network only where the conversation may without asking: else it stays offline (review of 2026-11-20)', async () => {
    const offline = rig();
    await offline.browser.agentOpenFile(page, root, { network: false });
    const id = offline.views[0]!.webContents.id;
    expect(await offline.browser.blocked(id, 'https://cdn.example/x.js')).toBe(true);
    expect(await offline.browser.blocked(id, 'http://127.0.0.1:5173/beacon')).toBe(true);
    expect(await offline.browser.blocked(id, 'ws://localhost:8080/')).toBe(true);
    const online = rig();
    await online.browser.agentOpenFile(page, root, { network: true });
    expect(await online.browser.blocked(online.views[0]!.webContents.id, 'https://cdn.example/x.js')).toBe(false);
    // The agent's next page of the internet is asked as the network: it is not the file's.
    await offline.browser.agentOpen('http://127.0.0.1:5173/');
    expect(await offline.browser.blocked(id, 'https://cdn.example/x.js')).toBe(false);
  });

  it('a link of the page goes to a file of its folder, never elsewhere on the disk, nor to the internet when it is offline', async () => {
    const { browser, views } = rig();
    await browser.agentOpenFile(page, root, { network: false });
    const tried = (url: string): boolean => {
      let prevented = false;
      views[0]!.emit('will-navigate', { preventDefault: () => (prevented = true) }, url);
      return prevented;
    };
    expect(tried(pathToFileURL(join(root, 'bac', 'level2.html')).href)).toBe(false);
    expect(tried(elsewhere)).toBe(true);
    expect(tried('https://example.com/')).toBe(true);
  });
});
