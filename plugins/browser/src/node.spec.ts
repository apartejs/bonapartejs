/**
 * The built-in browser's Node half (task 10.1): four tools on the pages the app keeps — open (network), read
 * and screenshot (read), act (execute). What a page says reaches the model as text, its console after it; a
 * failure is a result the model reads.
 */

import type { BrowserService, PluginNodeContext, PluginToolInvocation, PluginToolResult } from '@aparte/bonaparte-plugin-sdk';
import { describe, expect, it } from 'vitest';
import { browserManifest } from './index.js';
import { browser } from './node.js';

type Handler = (call: PluginToolInvocation) => Promise<PluginToolResult>;

async function rig(service?: Partial<BrowserService>) {
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
            ...service,
          },
        }
      : {}),
  } as unknown as PluginNodeContext;
  await browser.activate(ctx);
  return (name: string, input: unknown = {}) =>
    handlers.get(name)!({ input, conversationId: 'c1', roots: [], signal: { aborted: false, addEventListener: () => undefined }, use: async () => ({ content: '' }) } as unknown as PluginToolInvocation);
}

describe('the built-in browser plugin (task 10.1)', () => {
  it('declares its four tools with the effects of §9: open network, read and screenshot read, act execute', () => {
    expect(browserManifest.contributes?.tools?.map((tool) => [tool.name, tool.effect])).toEqual([
      ['browser_open', 'network'],
      ['browser_read', 'read'],
      ['browser_screenshot', 'read'],
      ['browser_act', 'execute'],
    ]);
  });

  it('opens an address in the browser, and says where it landed — or why not', async () => {
    const call = await rig({ open: async (url) => (url.includes('192.168') ? { error: 'Refused: a private address.' } : { url, title: 'Récap' }) });
    expect(await call('browser_open', { url: 'http://localhost:5173/rapport' })).toEqual({ content: 'Opened http://localhost:5173/rapport (Récap) in the browser.' });
    expect(await call('browser_open', { url: 'http://192.168.1.1' })).toMatchObject({ failed: true, content: expect.stringMatching(/private/) });
    expect(await call('browser_open', {})).toMatchObject({ failed: true });
  });

  it('reads the page shown — its text, then its console', async () => {
    const call = await rig({
      read: async () => ({
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
  });

  it('with no page open, reading or picturing says so', async () => {
    const call = await rig({});
    expect(await call('browser_read')).toMatchObject({ failed: true, content: expect.stringMatching(/No page/) });
    expect(await call('browser_screenshot')).toMatchObject({ failed: true });
  });

  it('a screenshot is kept for the person; the model is told it cannot see it', async () => {
    const call = await rig({ screenshot: async () => ({ url: 'http://localhost:5173/', width: 800, height: 600, saved: 'C:\\data\\screenshots\\1.png' }) });
    const shot = await call('browser_screenshot');
    expect(shot.content).toContain('800 × 600');
    expect(shot.content).toContain('you cannot see it');
  });

  it('acts on the page: a click, a text typed, a scroll — what does not exist is said', async () => {
    const asked: unknown[] = [];
    const call = await rig({
      act: async (action) => {
        asked.push(action);
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
