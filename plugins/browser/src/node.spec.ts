/**
 * The built-in browser's Node half (task 10.1): four tools on the pages the app keeps — open (network), read
 * and screenshot (read), act (execute). What a page says reaches the model as text, its console after it; a
 * failure is a result the model reads.
 */

import type { PluginBrowser, PluginNodeContext, PluginToolInvocation, PluginToolResult } from '@aparte/bonaparte-plugin-sdk';
import { describe, expect, it } from 'vitest';
import { browserManifest } from './index.js';
import { browser, pathOfFileUrl } from './node.js';

type Handler = (call: PluginToolInvocation) => Promise<PluginToolResult>;

async function rig(service?: Partial<PluginBrowser>, roots: readonly string[] = []) {
  const handlers = new Map<string, Handler>();
  const ctx = {
    pluginId: 'browser',
    registerToolHandler: (name: string, handler: Handler) => handlers.set(name, handler),
    log: () => undefined,
    ...(service
      ? {
          browser: {
            open: async () => ({ error: 'unused' }),
            read: async () => null,
            screenshot: async () => null,
            act: async () => ({ error: 'unused' }),
            openFile: async () => ({ error: 'unused' }),
            ...service,
          },
        }
      : {}),
  } as unknown as PluginNodeContext;
  await browser.activate(ctx);
  return (name: string, input: unknown = {}) =>
    handlers.get(name)!({ input, conversationId: 'c1', roots, signal: { aborted: false, addEventListener: () => undefined }, use: async () => ({ content: '' }) } as unknown as PluginToolInvocation);
}

describe('what the model reads of the browser (audit 2026-11-21, I3)', () => {
  it('each tool says it works in the agent’s own tab, a session apart — never the tab the person sees', () => {
    const tools = browserManifest.contributes?.tools ?? [];
    expect(tools).toHaveLength(5);
    for (const tool of tools) {
      expect(tool.description).toContain('your own browser tab');
      expect(tool.description).not.toMatch(/the person sees|the page shown|the person/);
      // Short: what, when, its limits — three sentences at most.
      expect(tool.description.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(3);
    }
    expect(tools.find((tool) => tool.name === 'browser_open')?.description).toContain('none of the user’s logins or cookies');
  });
});

describe('the built-in browser plugin (task 10.1)', () => {
  it('one browser_open for a page or a file; browser_open_file kept for the conversations told of it, hidden from new ones, pointing to it (Paul, 2026-11-20)', async () => {
    const tools = browserManifest.contributes?.tools ?? [];
    const open = tools.find((tool) => tool.name === 'browser_open')!;
    expect(Object.keys((open.inputSchema as { properties: object }).properties)).toEqual(['url', 'path']);
    expect(open.description).toContain('path for a file of the project as for read_file');
    expect(tools.find((tool) => tool.name === 'browser_open_file')?.hidden).toBe(true);
    expect(tools.filter((tool) => tool.hidden).map((tool) => tool.name)).toEqual(['browser_open_file']);
    const asked: string[] = [];
    const call = await rig({ openFile: async (path) => (asked.push(path), { url: 'file:///C:/projet/a.html', title: 'A' }) }, ['C:/projet']);
    expect(await call('browser_open_file', { path: 'a.html' })).toEqual({ content: 'Use browser_open with the same path.', failed: true });
    expect(asked).toEqual([]);
  });

  it('declares its tools with the effects of §9: open network, open a file of the project, read and screenshot read, act execute', () => {
    expect(browserManifest.contributes?.tools?.map((tool) => [tool.name, tool.effect])).toEqual([
      ['browser_open', 'network'],
      ['browser_open_file', 'read'],
      ['browser_read', 'read'],
      ['browser_screenshot', 'read'],
      ['browser_act', 'execute'],
    ]);
  });

  it('says to the person that it works on the agent’s own page, in its conversation — never the page shown (the browser redo, step 2, review)', () => {
    const said = browserManifest.effects.filter((one) => one.effect !== 'network').map((one) => one.what);
    expect(said).toHaveLength(2);
    for (const what of said) {
      expect(typeof what === 'string' ? what : what['en']).toMatch(/the agent’s own page, in its conversation/);
      expect(typeof what === 'string' ? what : what['fr']).toMatch(/la page de l’agent, dans sa conversation/);
      expect(JSON.stringify(what)).not.toMatch(/shown|affichée|sees|voit/);
    }
  });

  it('opens a file of the conversation’s folders — a page the agent wrote — in its perimeter, and says why not (Paul, 2026-11-20)', async () => {
    const asked: [string, { conversationId: string; roots: readonly string[] }][] = [];
    const call = await rig(
      {
        openFile: async (path, from) => {
          asked.push([path, from]);
          return path.endsWith('none.html') ? { error: 'There is no file at bac/none.html.' } : { url: 'file:///C:/projet/bac/snake3.html', title: 'Snake' };
        },
      },
      ['C:/projet'],
    );
    // One tool opens a page or a file (Paul, 2026-11-20): a path, as for read_file.
    expect(await call('browser_open', { path: 'bac/snake3.html' })).toEqual({ content: 'Opened file:///C:/projet/bac/snake3.html (Snake) in the browser.' });
    expect(await call('browser_open', { path: 'bac/none.html' })).toMatchObject({ failed: true, content: expect.stringMatching(/no file/) });
    expect(await call('browser_open', {})).toMatchObject({ failed: true, content: expect.stringMatching(/path/) });
    // The address a model writes for a file goes the same way: a file of the perimeter, never a page of the disk.
    expect(await call('browser_open', { url: 'file:///C:/projet/bac/snake3.html' })).toEqual({ content: 'Opened file:///C:/projet/bac/snake3.html (Snake) in the browser.' });
    expect(asked.map(([path]) => path)).toEqual(['bac/snake3.html', 'bac/none.html', 'C:/projet/bac/snake3.html']);
    expect(asked.every(([, from]) => from.roots[0] === 'C:/projet' && from.conversationId === 'c1')).toBe(true);
  });

  it('reads the path a file: address names — a drive, spaces and accents decoded; another machine’s is none', () => {
    expect(pathOfFileUrl('file:///C:/Users/WDAGUtilityAccount/Desktop/bac/snake3.html')).toBe('C:/Users/WDAGUtilityAccount/Desktop/bac/snake3.html');
    expect(pathOfFileUrl('file:///home/paul/mon%20jeu/caf%C3%A9.html')).toBe('/home/paul/mon jeu/café.html');
    expect(pathOfFileUrl('file://localhost/C:/a.html')).toBe('C:/a.html');
    expect(pathOfFileUrl('file://server/share/a.html')).toBeNull();
    expect(pathOfFileUrl('file:///C:/a%E0.html')).toBeNull();
    expect(pathOfFileUrl('https://example.com/')).toBeNull();
  });

  it('a page kept off the network is said so to the model: what it loads from the internet is blocked (review of 2026-11-20)', async () => {
    const call = await rig({ openFile: async () => ({ url: 'file:///C:/projet/a.html', title: 'A', offline: true }) }, ['C:/projet']);
    expect(await call('browser_open', { path: 'a.html' })).toEqual({
      content: 'Opened file:///C:/projet/a.html (A) in the browser. Its page is kept off the network here: what it loads from the internet or from a server of this machine is blocked.',
    });
  });

  it('opens an address in the browser, and says where it landed — or why not', async () => {
    const call = await rig({ open: async (url) => (url.includes('192.168') ? { error: 'Refused: a private address.' } : { url, title: 'Récap' }) });
    expect(await call('browser_open', { url: 'http://localhost:5173/rapport' })).toEqual({ content: 'Opened http://localhost:5173/rapport (Récap) in the browser.' });
    expect(await call('browser_open', { url: 'http://192.168.1.1' })).toMatchObject({ failed: true, content: expect.stringMatching(/private/) });
    expect(await call('browser_open', {})).toMatchObject({ failed: true });
  });

  it('reads its conversation’s page — its text, then its console', async () => {
    const asked: unknown[] = [];
    const call = await rig({
      read: async (from) => (asked.push(from), {
        url: 'http://localhost:5173/rapport',
        title: 'Récap',
        text: 'Total 7 h 15',
        console: [{ level: 'error', text: "Cannot read properties of undefined (reading 'minutes')", source: 'weekly.ts:42' }],
      }),
    });
    const read = await call('browser_read');
    expect(read.content).toContain('Récap — http://localhost:5173/rapport');
    expect(read.content).toContain('Total 7 h 15');
    expect(read.content).toContain('Console: 1 error, 0 warnings');
    expect(read.content).toContain("[error] Cannot read properties of undefined (reading 'minutes') (weekly.ts:42)");
    // The call's conversation: its agent's own tab, never another's (the browser redo, step 2).
    expect(asked).toEqual([{ conversationId: 'c1' }]);
  });

  it('with no page open, reading or picturing says so', async () => {
    const call = await rig({});
    expect(await call('browser_read')).toMatchObject({ failed: true, content: expect.stringMatching(/No page/) });
    expect(await call('browser_screenshot')).toMatchObject({ failed: true });
  });

  it('a screenshot is kept for the person; the model is told it cannot see it', async () => {
    const asked: unknown[] = [];
    const call = await rig({ screenshot: async (from) => (asked.push(from), { url: 'http://localhost:5173/', width: 800, height: 600, saved: 'C:\\data\\screenshots\\1.png' }) });
    const shot = await call('browser_screenshot');
    expect(shot.content).toContain('800 × 600');
    expect(shot.content).toContain('you cannot see it');
    expect(asked).toEqual([{ conversationId: 'c1' }]);
  });

  it('acts on the page: a click, a text typed, a scroll — what does not exist is said', async () => {
    const asked: unknown[] = [];
    const call = await rig({
      act: async (action, from) => {
        asked.push(action);
        expect(from).toEqual({ conversationId: 'c1' });
        return action.kind === 'click' && action.selector === '#missing' ? { error: 'No element matches #missing.' } : { done: 'clicked' };
      },
    });
    expect(await call('browser_act', { action: 'click', selector: 'button.export' })).toEqual({ content: 'Done: clicked.' });
    await call('browser_act', { action: 'type', selector: 'input', text: 'hello' });
    await call('browser_act', { action: 'scroll', by: 400 });
    expect(asked).toEqual([
      { kind: 'click', selector: 'button.export' },
      { kind: 'type', selector: 'input', text: 'hello' },
      { kind: 'scroll', by: 400 },
    ]);
    expect(await call('browser_act', { action: 'click', selector: '#missing' })).toMatchObject({ failed: true });
    expect(await call('browser_act', { action: 'dance' })).toMatchObject({ failed: true });
  });

  it('where the app has no browser, every tool says so', async () => {
    const call = await rig();
    expect(await call('browser_open', { url: 'http://x' })).toMatchObject({ failed: true, content: expect.stringMatching(/not available/) });
  });
});
