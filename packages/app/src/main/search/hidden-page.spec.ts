/**
 * The hidden page that searches the public engine (task 10.4), with a window and a session that record what is
 * done to them: no Electron, no network. What it loads, what it lets through, what it reads, and that it goes.
 */

import { describe, expect, it, vi } from 'vitest';
import { createHiddenSearch, type HiddenWindow, type SearchSession } from './hidden-page.js';

function rig(page: { blocked?: boolean; results?: unknown[]; hang?: boolean } = {}) {
  const loaded: string[] = [];
  let destroyed = 0;
  let stopped = 0;
  let filter: ((details: { url: string }, callback: (answer: { cancel: boolean }) => void) => void) | undefined;
  let permissions: ((...args: unknown[]) => void) | undefined;
  let opened: (() => { action: string }) | undefined;
  const window: HiddenWindow = {
    webContents: {
      loadURL: (url) => {
        loaded.push(url);
        return page.hang ? new Promise(() => undefined) : Promise.resolve();
      },
      executeJavaScript: async () => ({ blocked: page.blocked ?? false, results: page.results ?? [] }),
      setUserAgent: () => undefined,
      setAudioMuted: () => undefined,
      setWindowOpenHandler: (handler) => void (opened = handler),
      stop: () => void (stopped += 1),
    },
    isDestroyed: () => destroyed > 0,
    destroy: () => void (destroyed += 1),
  };
  const session: SearchSession = {
    webRequest: { onBeforeRequest: (listener) => void (filter = listener) },
    setPermissionRequestHandler: (handler) => void (permissions = handler as (...args: unknown[]) => void),
  };
  const hidden = createHiddenSearch({ window: () => window, session: () => session, engine: 'https://html.duckduckgo.com/html/?q=' });
  const allowed = (url: string) =>
    new Promise<boolean>((resolve) => filter!({ url }, (answer) => resolve(!answer.cancel)));
  return { hidden, loaded, allowed, destroyed: () => destroyed, stopped: () => stopped, permissions: () => permissions, opened: () => opened };
}

describe('the hidden page of the web search (task 10.4)', () => {
  it('loads the engine’s page with the query, and gives its results as the page shows them', async () => {
    const results = [{ title: 'KV', href: '//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com', snippet: 'kept' }];
    const { hidden, loaded } = rig({ results });
    expect(await hidden.search('kv cache & more', 3)).toEqual(results);
    expect(loaded).toEqual(['https://html.duckduckgo.com/html/?q=kv%20cache%20%26%20more']);
  });

  it('lets through only the engine’s own host: never this machine, the network it is in, nor another site', async () => {
    const { hidden, allowed } = rig({ results: [] });
    await hidden.search('x', 1);
    expect(await allowed('https://html.duckduckgo.com/html/?q=x')).toBe(true);
    expect(await allowed('http://127.0.0.1:8080/admin')).toBe(false);
    expect(await allowed('http://192.168.1.1/')).toBe(false);
    expect(await allowed('https://tracker.example/pixel')).toBe(false);
    expect(await allowed('file:///C:/Windows/win.ini')).toBe(false);
  });

  it('asks for no permission and opens no window', async () => {
    const { hidden, permissions, opened } = rig({ results: [] });
    await hidden.search('x', 1);
    let granted: boolean | undefined;
    permissions()!(null, 'geolocation', (answer: boolean) => (granted = answer));
    expect(granted).toBe(false);
    expect(opened()!()).toEqual({ action: 'deny' });
  });

  it('a page that asks for a verification is said, never read as no result', async () => {
    const { hidden } = rig({ blocked: true });
    await expect(hidden.search('x', 1)).rejects.toThrow(/verification/);
  });

  it('a search stopped with its turn stops the page', async () => {
    const { hidden, stopped, loaded } = rig({ hang: true });
    const controller = new AbortController();
    const running = hidden.search('x', 1, controller.signal);
    await vi.waitFor(() => expect(loaded).toHaveLength(1));
    controller.abort();
    await expect(running).rejects.toThrow(/stopped/i);
    expect(stopped()).toBe(1);
  });

  it('goes when the app goes', async () => {
    const { hidden, destroyed } = rig({ results: [] });
    await hidden.search('x', 1);
    hidden.dispose();
    expect(destroyed()).toBe(1);
  });
});
