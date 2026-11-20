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
import { PERSON_PARTITION, partitionOf, type TabOwner } from './sessions.js';
import { BrowserViews, readingSignal, windowHost, type PageView } from './views.js';

/** The conversation whose agent calls, and another one. */
const C1 = { conversationId: 'c1', projectId: 'p1' };
const C2 = { conversationId: 'c2', projectId: 'p1' };

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
  const owners: TabOwner[] = [];
  const attached = new Set<FakeView>();
  const changes: number[] = [];
  const browser = new BrowserViews({
    create: (owner) => {
      const view = fakeView(page);
      views.push(view);
      owners.push(owner);
      return view;
    },
    host: { attach: (view) => void attached.add(view as FakeView), detach: (view) => void attached.delete(view as FakeView) },
    changed: () => changes.push(1),
  });
  return { browser, views, owners, attached, changes };
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
    expect(browser.states(null)[0]).toMatchObject({ tabId: 't1', error: expect.stringMatching(/REFUSED/) });
  });

  it('the console is kept, counted: errors and warnings', () => {
    const { browser, views } = rig();
    browser.openTab('t1');
    views[0]!.emit('console-message', { level: 'error', message: 'TypeError: x', lineNumber: 42, sourceId: 'weekly.ts' });
    views[0]!.emit('console-message', { level: 'warning', message: 'no alt', lineNumber: 1, sourceId: 'a.ts' });
    views[0]!.emit('console-message', { level: 'info', message: 'ready', lineNumber: 1, sourceId: 'a.ts' });
    expect(browser.states(null)[0]).toMatchObject({ errors: 1, warnings: 1 });
    expect(browser.console('t1')).toEqual([
      { level: 'error', text: 'TypeError: x', source: 'weekly.ts:42' },
      { level: 'warning', text: 'no alt', source: 'a.ts:1' },
      { level: 'info', text: 'ready', source: 'a.ts:1' },
    ]);
  });

  it('the agent opens, reads and acts on its conversation’s own tab, made at its first page in its project’s session', async () => {
    const { browser, views, owners } = rig({ title: 'Récap', read: { title: 'Récap', text: 'Total 7 h 15' } });
    expect(await browser.agentOpen('http://localhost:5173/rapport', C1)).toMatchObject({ url: 'http://localhost:5173/rapport', title: 'Récap' });
    expect(views).toHaveLength(1);
    expect(owners).toEqual([C1]);
    expect(browser.states('c1').map((tab) => [tab.tabId, tab.agent])).toEqual([['agent:c1', true]]);
    expect(await browser.agentRead(C1)).toMatchObject({ url: 'http://localhost:5173/rapport', text: 'Total 7 h 15' });
    await browser.agentAct({ kind: 'click', selector: 'button.export"]' }, C1);
    // The selector reaches the page as JSON: a quote cannot close the script's string.
    expect(views[0]!.scripts.at(-1)).toContain(JSON.stringify('button.export"]'));
  });

  it('the agent may open this machine’s own pages (a dev server), never the network it is in', async () => {
    const { browser } = rig();
    expect(await browser.agentOpen('http://192.168.1.10/admin', C1)).toMatchObject({ error: expect.stringMatching(/private/) });
    expect(await browser.agentOpen('http://127.0.0.1:3000/', C1)).toMatchObject({ url: 'http://127.0.0.1:3000/' });
  });

  it('a screenshot of the tab shown: its size, the image kept for the window', async () => {
    const { browser } = rig();
    await browser.agentOpen('http://localhost:5173/', C1);
    expect(await browser.agentScreenshot(C1)).toMatchObject({ width: 800, height: 600, png: new Uint8Array([1, 2, 3]) });
  });
});

describe('one agent’s tab per conversation, never the person’s (the browser redo, step 2)', () => {
  it('two conversations’ agents each open and read their own page; the person’s tab is left as it was', async () => {
    const pages = new Map<string, string>();
    const views: FakeView[] = [];
    const owners: TabOwner[] = [];
    const browser = new BrowserViews({
      create: (owner) => {
        owners.push(owner);
        const view = fakeView();
        // Each page says where it is.
        view.webContents.executeJavaScript = async (code) => {
          view.scripts.push(code);
          return { title: 'Page', text: pages.get(view.webContents.getURL()) ?? '' };
        };
        views.push(view);
        return view;
      },
      host: { attach: () => undefined, detach: () => undefined },
      changed: () => undefined,
    });
    pages.set('http://localhost:5173/mine', 'the person’s').set('http://localhost:5173/a', 'page A').set('http://localhost:5173/b', 'page B');
    browser.openTab('t1');
    await browser.navigate('t1', 'http://localhost:5173/mine');
    browser.place('t1', RECT, 'desktop');
    await browser.agentOpen('http://localhost:5173/a', C1);
    await browser.agentOpen('http://localhost:5173/b', C2);
    expect(await browser.agentRead(C1)).toMatchObject({ text: 'page A' });
    expect(await browser.agentRead(C2)).toMatchObject({ text: 'page B' });
    expect(await browser.agentAct({ kind: 'click', selector: 'button' }, C2)).not.toHaveProperty('error');
    expect(views).toHaveLength(3);
    // Each tab built in its owner's session: the person's, then each conversation's agent's — never the person's.
    expect(owners).toEqual(['person', C1, C2]);
    expect(owners.slice(1).map((owner) => partitionOf(owner))).not.toContain(PERSON_PARTITION);
    expect(views[0]!.loaded).toEqual(['http://localhost:5173/mine']);
    expect(views[0]!.scripts).toEqual([]);
    // A conversation whose agent opened nothing has nothing to read.
    expect(await browser.agentRead({ conversationId: 'c3' })).toBeNull();
    expect(await browser.agentScreenshot({ conversationId: 'c3' })).toBeNull();
    expect(await browser.agentAct({ kind: 'scroll', by: 100 }, { conversationId: 'c3' })).toEqual({ error: 'No page is open in the browser: open one with browser_open.' });
  });

  it('the pane lists the person’s tabs and its own conversation’s agent tab only, marked', async () => {
    const { browser } = rig();
    browser.openTab('t1');
    await browser.agentOpen('http://localhost:5173/a', C1);
    await browser.agentOpen('http://localhost:5173/b', C2);
    expect(browser.states('c1').map((tab) => [tab.tabId, tab.agent ?? false])).toEqual([
      ['t1', false],
      ['agent:c1', true],
    ]);
    expect(browser.states('c2').map((tab) => tab.tabId)).toEqual(['t1', 'agent:c2']);
    expect(browser.states(null).map((tab) => tab.tabId)).toEqual(['t1']);
  });

  it('an agent’s tab is never built in the person’s session, whatever opens it: a page, a file (review of step 2)', async () => {
    const { browser, owners } = rig();
    browser.openTab('t1');
    await browser.agentOpen('http://localhost:5173/a', C1);
    await browser.agentOpenFile(join(tmpdir(), 'page.html'), tmpdir(), { network: false, ...C2 });
    await browser.agentOpen('http://localhost:5173/b', { conversationId: 'c3' });
    expect(owners).toEqual(['person', C1, C2, { conversationId: 'c3' }]);
    expect(owners.map((owner) => partitionOf(owner) === PERSON_PARTITION)).toEqual([true, false, false, false]);
  });

  it('a conversation never reads another conversation’s file page (review of step 2)', async () => {
    const { browser, views } = rig({ read: { title: 'Snake', text: 'secret of c1' } });
    await browser.agentOpenFile(join(tmpdir(), 'snake.html'), tmpdir(), { network: false, ...C1 });
    expect(await browser.agentRead(C2)).toBeNull();
    expect(await browser.agentScreenshot(C2)).toBeNull();
    expect(await browser.agentAct({ kind: 'click', selector: 'a' }, C2)).toMatchObject({ error: expect.stringMatching(/No page/) });
    expect(views[0]!.scripts).toEqual([]);
    expect(browser.states('c2').map((tab) => tab.tabId)).toEqual([]);
  });

  it('a conversation deleted or archived takes its agent’s tab with it, and only its own (review of step 2)', async () => {
    const closed: number[] = [];
    const { browser, views, attached } = rig();
    browser.openTab('t1');
    await browser.agentOpen('http://localhost:5173/a', C1);
    await browser.agentOpen('http://localhost:5173/b', C2);
    for (const view of views) view.webContents.close = () => void closed.push(view.webContents.id);
    browser.place('agent:c1', RECT, 'desktop');
    expect(attached.has(views[1]!)).toBe(true);
    browser.closeAgentTab('c1');
    expect(closed).toEqual([views[1]!.webContents.id]);
    expect(attached.size).toBe(0);
    expect(browser.states('c1').map((tab) => tab.tabId)).toEqual(['t1']);
    expect(browser.states('c2').map((tab) => tab.tabId)).toEqual(['t1', 'agent:c2']);
    expect(await browser.agentRead(C1)).toBeNull();
    // A conversation whose agent opened nothing: nothing to close.
    browser.closeAgentTab('c9');
    expect(closed).toHaveLength(1);
  });

  it('the window cannot open a tab in the agent’s name', () => {
    const { browser, owners } = rig();
    browser.openTab('agent:c1');
    expect(browser.states('c1')).toEqual([]);
    browser.openTab('t1');
    expect(owners).toEqual(['person']);
  });

  it('a conversation without a project has an agent’s tab too; moved to another project, its next page opens in that project’s session', async () => {
    const { browser, owners } = rig();
    await browser.agentOpen('http://localhost:5173/', { conversationId: 'c9' });
    await browser.agentOpen('http://localhost:5173/', { conversationId: 'c9' });
    await browser.agentOpen('http://localhost:5173/', { conversationId: 'c9', projectId: 'p2' });
    expect(owners).toEqual([{ conversationId: 'c9' }, { conversationId: 'c9', projectId: 'p2' }]);
    expect(browser.states('c9').map((tab) => tab.tabId)).toEqual(['agent:c9']);
  });

  it('the agent’s page is shown unless the person looks at a tab of their own in a visible pane', async () => {
    const { browser } = rig();
    browser.openTab('t1');
    await browser.navigate('t1', 'http://localhost:5173/mine');
    // The pane closed: the agent's tab becomes the one shown.
    await browser.agentOpen('http://localhost:5173/a', C1);
    expect(browser.shownIn('c1')).toBe('agent:c1');
    // Not in another conversation's pane.
    expect(browser.shownIn('c2')).toBeNull();
    // The person shows their own tab in c1's pane: the agent's next page does not take its place.
    browser.place('t1', RECT, 'desktop', 'c1');
    expect(browser.shownIn('c1')).toBe('t1');
    await browser.agentOpen('http://localhost:5173/b', C1);
    expect(browser.shownIn('c1')).toBe('t1');
    // Hidden again, it is.
    browser.hideAll();
    await browser.agentOpen('http://localhost:5173/c', C1);
    expect(browser.shownIn('c1')).toBe('agent:c1');
  });

  it('a page the agent opened while the person looked at their own tab in another conversation is shown back in its own (review of step 2)', async () => {
    const { browser } = rig();
    browser.openTab('t1');
    await browser.navigate('t1', 'http://localhost:5173/mine');
    // The person looks at their tab in c2's pane while c1's agent opens a page.
    browser.place('t1', RECT, 'desktop', 'c2');
    await browser.agentOpen('http://localhost:5173/a', C1);
    // c2's pane keeps the person's tab; back in c1, its agent's new page is the one shown.
    expect(browser.shownIn('c2')).toBe('t1');
    expect(browser.shownIn('c1')).toBe('agent:c1');
    // Placed in c1's pane, it is seen: the person's next choice is followed again.
    browser.place('agent:c1', RECT, 'desktop', 'c1');
    browser.place('t1', RECT, 'desktop', 'c1');
    expect(browser.shownIn('c1')).toBe('t1');
    // In its own conversation's pane, the person's tab keeps its place: the agent's page waits behind its own tab.
    await browser.agentOpen('http://localhost:5173/b', C1);
    expect(browser.shownIn('c1')).toBe('t1');
  });

  it('an agent’s page opened while a page covered the person’s tab in another conversation is still shown back in its own (second review of step 2)', async () => {
    const covers = [
      (browser: BrowserViews) => browser.place('t1', null, 'desktop', 'c2'),
      (browser: BrowserViews) => browser.hideAll(),
    ];
    for (const cover of covers) {
      const { browser } = rig();
      browser.openTab('t1');
      await browser.navigate('t1', 'http://localhost:5173/mine');
      browser.place('t1', RECT, 'desktop', 'c2');
      // « À traiter » or the settings go over c2's pane: the person's tab is taken off.
      cover(browser);
      await browser.agentOpen('http://localhost:5173/a', C1);
      // The page over the conversation goes: c2's pane places the person's tab again.
      browser.place('t1', RECT, 'desktop', 'c2');
      expect(browser.shownIn('c2')).toBe('t1');
      // Back in c1, its agent's new page is the one shown.
      expect(browser.shownIn('c1')).toBe('agent:c1');
    }
  });

  it('a tab with nothing to show takes the page placed off: a blank « Nouvel onglet » leaves no page over the pane (second review of step 2)', async () => {
    const { browser, views, attached } = rig();
    await browser.agentOpen('http://localhost:5173/a', C1);
    browser.place('agent:c1', RECT, 'desktop', 'c1');
    expect(attached.has(views[0]!)).toBe(true);
    browser.openTab('t1');
    // The pane shows the blank tab: placed nowhere, and nothing else stays placed.
    browser.place('t1', null, 'desktop', 'c1', { blank: true });
    expect(attached.size).toBe(0);
    expect(browser.placement()).toBeNull();
    expect(browser.shownIn('c1')).toBe('t1');
  });

  it('a blank « Nouvel onglet » in a visible pane is the person’s: the agent’s page waits behind it, marked, and the address the person types goes to their tab (third review of step 2)', async () => {
    const { browser, views, attached } = rig();
    browser.openTab('t1');
    // The pane shows the blank tab: nothing to attach, but the person looks at it.
    browser.place('t1', null, 'desktop', 'c1', { blank: true });
    await browser.agentOpen('http://localhost:5173/a', C1);
    expect(browser.shownIn('c1')).toBe('t1');
    expect(attached.size).toBe(0);
    expect(browser.states('c1').find((tab) => tab.agent)).toMatchObject({ fresh: true });
    // The person types an address: their own tab goes there, the agent's stays on its page.
    await browser.navigate(browser.shownIn('c1')!, 'http://localhost:5173/mine');
    expect(views[0]!.loaded).toEqual(['http://localhost:5173/mine']);
    expect(views[1]!.loaded).toEqual(['http://localhost:5173/a']);
    // The agent's tab placed, its page is seen: the mark goes.
    browser.place('agent:c1', RECT, 'desktop', 'c1');
    expect(browser.states('c1').find((tab) => tab.agent)?.fresh).toBeUndefined();
  });

  it('an agent’s page opened while its conversation’s pane was closed is shown when the person comes back, whatever another conversation’s pane showed meanwhile (third review of step 2)', async () => {
    const { browser } = rig();
    browser.openTab('t1');
    await browser.navigate('t1', 'http://localhost:5173/mine');
    browser.place('t1', RECT, 'desktop', 'c1');
    // The person goes to c2: c1's pane is closed.
    browser.hideAll();
    await browser.agentOpen('http://localhost:5173/a', C1);
    // c2's pane opens on the person's tab.
    browser.place('t1', RECT, 'desktop', 'c2');
    expect(browser.shownIn('c2')).toBe('t1');
    // Back in c1, its agent's new page is the one shown.
    expect(browser.shownIn('c1')).toBe('agent:c1');
    // A page opened while the person looked at their tab in c1's pane waits behind it, marked; the person leaves
    // c1 and comes back: it is the one shown.
    browser.place('t1', RECT, 'desktop', 'c1');
    await browser.agentOpen('http://localhost:5173/b', C1);
    expect(browser.shownIn('c1')).toBe('t1');
    browser.hideAll();
    browser.place('t1', RECT, 'desktop', 'c2');
    expect(browser.shownIn('c1')).toBe('agent:c1');
  });

  it('each conversation’s pane keeps its own tab shown (third review of step 2)', async () => {
    const { browser } = rig();
    browser.openTab('t1');
    browser.openTab('t2');
    browser.place('t1', RECT, 'desktop', 'c1');
    browser.place('t2', RECT, 'desktop', 'c2');
    expect(browser.shownIn('c1')).toBe('t1');
    expect(browser.shownIn('c2')).toBe('t2');
    // An agent's page in c2, while c2's pane shows the person's tab: c1's choice is left alone.
    await browser.agentOpen('http://localhost:5173/b', C2);
    expect(browser.shownIn('c1')).toBe('t1');
    expect(browser.shownIn('c2')).toBe('t2');
    // A tab closed is shown nowhere any more.
    browser.closeTab('t1');
    expect(browser.shownIn('c1')).toBeNull();
    expect(browser.shownIn('c2')).toBe('t2');
  });
});

describe('the person’s tools on a page (task 10.2)', () => {
  it('Electron’s own warnings are not the page’s: they are neither counted nor listed', () => {
    const { browser, views } = rig();
    browser.openTab('t1');
    views[0]!.emit('console-message', { level: 'warning', message: 'Electron Security Warning (Insecure Content-Security-Policy) This renderer…', lineNumber: 0, sourceId: 'x' });
    views[0]!.emit('console-message', { level: 'warning', message: 'no alt', lineNumber: 1, sourceId: 'a.ts' });
    expect(browser.states(null)[0]).toMatchObject({ warnings: 1 });
    expect(browser.console('t1').map((line) => line.text)).toEqual(['no alt']);
  });


  const PICKED = { selector: 'td.num', path: 'table › tbody › tr:nth-child(1)', text: '7 h 15', width: 64, height: 32, fontSize: 14, bold: true, color: 'rgb(29, 29, 27)', x: 120, y: 80 };

  it('« Sélectionner un élément » gives back what the page says of the element clicked, outlined in the accent', async () => {
    const { browser, views } = rig({ read: PICKED });
    await browser.agentOpen('http://localhost:5173/', C1);
    expect(await browser.pick(browser.states('c1')[0]!.tabId, '#087ea4')).toEqual(PICKED);
    expect(views[0]!.scripts.at(-1)).toContain('#087ea4');
  });

  it('a colour that is not one never reaches the page’s style', async () => {
    const { browser, views } = rig({ read: null });
    await browser.agentOpen('http://localhost:5173/', C1);
    const tabId = browser.states('c1')[0]!.tabId;
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
    await browser.agentOpen('http://localhost:5173/', C1);
    const tabId = browser.states('c1')[0]!.tabId;
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
    expect(await browser.agentOpen('http://93.184.216.34/', C1)).toMatchObject({ url: 'http://192.168.1.1/admin' });
    await expect(browser.agentRead(C1)).rejects.toThrow(/private address/);
    await expect(browser.agentScreenshot(C1)).rejects.toThrow(/private address/);
    expect(await browser.agentAct({ kind: 'click', selector: 'button' }, C1)).toMatchObject({ error: expect.stringMatching(/private address/) });
  });

  it('a page the agent opened is not redirected into that network; the person’s page may go there', async () => {
    const { browser, views } = rig();
    await browser.agentOpen('http://93.184.216.34/', C1);
    const redirect = (view: FakeView, to: string): boolean => {
      let prevented = false;
      view.emit('will-redirect', { preventDefault: () => (prevented = true) }, to);
      return prevented;
    };
    expect(redirect(views[0]!, 'http://10.0.0.1/')).toBe(true);
    expect(redirect(views[0]!, 'http://127.0.0.1:5173/')).toBe(false);
    expect(redirect(views[0]!, 'https://93.184.216.35/')).toBe(false);
    browser.openTab('t1');
    await browser.navigate('t1', 'http://93.184.216.34/');
    expect(redirect(views[1]!, 'http://10.0.0.1/')).toBe(false);
    // The agent's tab stays the agent's, whoever drives it: the person typing in it does not take it there either.
    expect(await browser.navigate('agent:c1', 'http://192.168.1.1/')).toMatchObject({ error: expect.stringMatching(/private/) });
    expect(redirect(views[0]!, 'http://10.0.0.1/')).toBe(true);
  });

  it('a page the person opened is never the agent’s: not read, pictured nor acted on, even shown (Paul, 2026-11-20)', async () => {
    const { browser, views } = rig({ read: { title: 'Routeur', text: 'status' } });
    browser.openTab('t1');
    await browser.navigate('t1', 'http://192.168.1.1/');
    browser.place('t1', RECT, 'desktop');
    expect(await browser.agentRead(C1)).toBeNull();
    expect(await browser.agentScreenshot(C1)).toBeNull();
    expect(await browser.agentAct({ kind: 'click', selector: 'button' }, C1)).toEqual({ error: 'No page is open in the browser: open one with browser_open.' });
    expect(views[0]!.scripts).toEqual([]);
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
    expect(await watched.agentOpen('http://rebind.example/', C1)).toMatchObject({ url: 'http://rebind.example/' });
    // The name answered a public address to Node, then a private one to Chromium.
    watched.responded(views[0]!.webContents.id, '192.168.1.1');
    await expect(watched.agentRead(C1)).rejects.toThrow(/private/);
    // A new page the agent opens starts clean.
    expect(await watched.agentOpen('http://other.example/', C1)).toMatchObject({ url: 'http://other.example/' });
    watched.responded(views[0]!.webContents.id, '93.184.216.34');
    await expect(watched.agentRead(C1)).resolves.toMatchObject({ url: 'http://other.example/' });
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
    await browser.agentOpen('http://public.example/', C1);
    const id = views[0]!.webContents.id;
    expect(await browser.blocked(id, 'http://router.lan/apply.cgi')).toBe(true);
    expect(await browser.blocked(id, 'ws://router.lan:8123/api/websocket')).toBe(true);
    expect(await browser.blocked(id, 'http://dev.local:3000/')).toBe(false);
    expect(await browser.blocked(id, 'https://cdn.example/x.js')).toBe(false);
  });

  it('the agent never acts on a page the person loaded: it stays theirs, where it goes is not the agent’s (Paul, 2026-11-20)', async () => {
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
    expect(await browser.agentAct({ kind: 'click', selector: 'a' }, C1)).toMatchObject({ error: expect.stringMatching(/No page/) });
    expect(views[0]!.scripts).toEqual([]);
    expect(await browser.blocked(views[0]!.webContents.id, 'http://192.168.1.1/')).toBe(false);
  });

  it('a page of the network this machine is in that the person opened stays theirs: the agent cannot act on it (review of phase 13)', async () => {
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
    expect(await browser.agentAct({ kind: 'click', selector: 'button' }, C1)).toMatchObject({ error: expect.stringMatching(/No page/) });
    expect(views[0]!.scripts).toEqual([]);
    expect(await browser.blocked(views[0]!.webContents.id, 'http://192.168.1.50/api/save')).toBe(false);
  });

  it('a request no page names, in an agent’s session, is judged like its page’s: a private address, or a name its session resolves to one (review of step 2)', async () => {
    const asked: [string, string][] = [];
    const browser = new BrowserViews({
      create: () => fakeView(),
      host: { attach: () => undefined, detach: () => undefined },
      changed: () => undefined,
      lookup: async () => ['93.184.216.34'],
      pageLookup: async (host, partition) => {
        asked.push([host, partition]);
        return host === 'router.lan' ? ['192.168.1.1'] : host === 'dev.local' ? ['127.0.0.1'] : ['93.184.216.34'];
      },
    });
    const partition = 'persist:bonaparte-agent-p1';
    expect(await browser.blockedWithoutPage('http://10.0.0.5/sw-sync', partition)).toBe(true);
    expect(await browser.blockedWithoutPage('http://[fd00::1]/', partition)).toBe(true);
    expect(await browser.blockedWithoutPage('http://router.lan/apply.cgi', partition)).toBe(true);
    expect(await browser.blockedWithoutPage('http://dev.local:3000/', partition)).toBe(false);
    expect(await browser.blockedWithoutPage('http://127.0.0.1:5173/', partition)).toBe(false);
    expect(await browser.blockedWithoutPage('https://cdn.example/x.js', partition)).toBe(false);
    // No file of the disk for a request no page names.
    expect(await browser.blockedWithoutPage(pathToFileURL(join(tmpdir(), 'x.html')).href, partition)).toBe(true);
    // Resolved in the session it came from.
    expect(asked).toEqual([
      ['router.lan', partition],
      ['dev.local', partition],
      ['cdn.example', partition],
    ]);
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
    await browser.agentOpen('http://rebind.example/', C1);
    await expect(browser.agentRead(C1)).rejects.toThrow(/private/);
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
    await browser.agentOpen('http://public.example/', C1);
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
    expect(await browser.agentOpenFile(page, root, { network: false, ...C1 })).toMatchObject({ url: pathToFileURL(page).href, title: 'Snake' });
    expect(views[0]!.loaded).toEqual([pathToFileURL(page).href]);
    expect(await browser.agentRead(C1)).toMatchObject({ text: 'Score: 0' });
  });

  it('its page loads from its folder only: the rest of the disk is cancelled, and so is a file in any other tab', async () => {
    const { browser, views } = rig();
    await browser.agentOpenFile(page, root, { network: true, ...C1 });
    const id = views[0]!.webContents.id;
    expect(await browser.blocked(id, pathToFileURL(join(root, 'bac', 'snake.js')).href)).toBe(false);
    expect(await browser.blocked(id, elsewhere)).toBe(true);
    // A file that is not there loads nothing either.
    expect(await browser.blocked(id, pathToFileURL(join(root, 'bac', 'none.js')).href)).toBe(true);
    // A page the person opened, or a page of the agent's once it went to the internet, loads no file.
    browser.openTab('t2');
    await browser.navigate('t2', 'http://localhost:5173/');
    expect(await browser.blocked(views[1]!.webContents.id, pathToFileURL(page).href)).toBe(true);
    await browser.agentOpen('http://localhost:5173/', C1);
    expect(await browser.blocked(views[0]!.webContents.id, pathToFileURL(page).href)).toBe(true);
  });

  it('a link of the project that leads out of it is judged where it leads: cancelled (security rule 6, review of 2026-11-20)', async () => {
    const { browser, views } = rig();
    await browser.agentOpenFile(page, root, { network: false, ...C1 });
    const through = pathToFileURL(join(root, 'docs', 'secret.html')).href;
    expect(await browser.blocked(views[0]!.webContents.id, through)).toBe(true);
    let prevented = false;
    views[0]!.emit('will-navigate', { preventDefault: () => (prevented = true) }, through);
    expect(prevented).toBe(true);
  });

  it('its page reaches the network only where the conversation may without asking: else it stays offline (review of 2026-11-20)', async () => {
    const offline = rig();
    await offline.browser.agentOpenFile(page, root, { network: false, ...C1 });
    const id = offline.views[0]!.webContents.id;
    expect(await offline.browser.blocked(id, 'https://cdn.example/x.js')).toBe(true);
    expect(await offline.browser.blocked(id, 'http://127.0.0.1:5173/beacon')).toBe(true);
    expect(await offline.browser.blocked(id, 'ws://localhost:8080/')).toBe(true);
    const online = rig();
    await online.browser.agentOpenFile(page, root, { network: true, ...C1 });
    expect(await online.browser.blocked(online.views[0]!.webContents.id, 'https://cdn.example/x.js')).toBe(false);
    // The agent's next page of the internet is asked as the network: it is not the file's.
    await offline.browser.agentOpen('http://127.0.0.1:5173/', C1);
    expect(await offline.browser.blocked(id, 'https://cdn.example/x.js')).toBe(false);
  });

  it('a link of the page goes to a file of its folder, never elsewhere on the disk, nor to the internet when it is offline', async () => {
    const { browser, views } = rig();
    await browser.agentOpenFile(page, root, { network: false, ...C1 });
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
