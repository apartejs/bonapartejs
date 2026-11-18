/**
 * The pages of the built-in browser (task 10.1), with views that record what is done to them: no Electron.
 * A page is placed only where the pane says, and taken off when its tab or the pane is hidden — a native view
 * sits above the window's page; only http(s) is ever loaded; the agent works on the tab shown.
 */

import { describe, expect, it } from 'vitest';
import { BrowserViews, type PageView } from './views.js';

interface FakeView extends PageView {
  loaded: string[];
  bounds: { x: number; y: number; width: number; height: number } | null;
  scripts: string[];
  emit(event: string, ...args: unknown[]): void;
  prevented: string[];
}

function fakeView(page: { title?: string; read?: unknown; failLoad?: boolean } = {}): FakeView {
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
      loadURL: async (target) => {
        view.loaded.push(target);
        url = target;
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
    await browser.pins(tabId, [{ n: 1, x: 10, y: 20 }], "red'); alert('x");
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
    await browser.pins(tabId, [{ n: 1, x: 10.4, y: 20.6 }, { n: 2, x: 300, y: 40 }], '#087ea4');
    expect(views[0]!.scripts.at(-1)).toContain(JSON.stringify([{ n: 1, x: 10, y: 21 }, { n: 2, x: 300, y: 40 }]));
    await browser.cancelPick(tabId);
    expect(views[0]!.scripts.at(-1)).toContain('Escape');
  });
});
