/**
 * The web search's Node half (task 10.4): one tool, `web_search`, whose search is the app's (the context's
 * `search`, given to a plugin that declares `network`). It checks what the model asks, says what came back in
 * words the model reads, and says a failure as a result — never an exception.
 */

import type { PluginNodeContext, PluginToolInvocation, PluginToolResult } from '@aparte/bonaparte-plugin-sdk';
import { describe, expect, it } from 'vitest';
import { formatResults, webSearch } from './node.js';
import { webSearchManifest } from './index.js';

type Handler = (call: PluginToolInvocation) => Promise<PluginToolResult>;

async function rig(search?: PluginNodeContext['search']) {
  const handlers = new Map<string, Handler>();
  const ctx = {
    pluginId: 'web-search',
    registerToolHandler: (name: string, handler: Handler) => handlers.set(name, handler),
    log: () => undefined,
    ...(search ? { search } : {}),
  } as unknown as PluginNodeContext;
  await webSearch.activate(ctx);
  const call = (input: unknown) =>
    handlers.get('web_search')!({ input, conversationId: 'c1', roots: [], signal: { aborted: false, addEventListener: () => undefined }, use: async () => ({ content: '' }) } as unknown as PluginToolInvocation);
  return { call };
}

describe('the web search plugin (task 10.4)', () => {
  it('declares one tool, web_search, with the network effect — web_fetch stays the core’s', () => {
    expect(webSearchManifest.effects.map((effect) => effect.effect)).toEqual(['network']);
    expect(webSearchManifest.contributes?.tools?.map((tool) => [tool.name, tool.effect])).toEqual([['web_search', 'network']]);
  });

  it('searches with what the model asked, the count kept between 1 and 10, and lists the results', async () => {
    const asked: [string, number][] = [];
    const { call } = await rig(async (query, max) => {
      asked.push([query, max]);
      return { provider: 'embedded', results: [{ title: 'KV cache', url: 'https://example.com/kv', snippet: 'What it keeps.' }] };
    });
    const result = await call({ query: ' kv cache ', maxResults: 40 });
    expect(asked).toEqual([['kv cache', 10]]);
    expect(result.failed).toBeUndefined();
    expect(result.content).toContain('1. KV cache — https://example.com/kv');
    expect(result.content).toContain('web_fetch');
    await call({ query: 'x', maxResults: 0 });
    await call({ query: 'y' });
    expect(asked.slice(1)).toEqual([['x', 1], ['y', 6]]);
  });

  it('a query missing, or a search that fails, is a failed result the model reads', async () => {
    const { call } = await rig(async () => {
      throw new Error('the engine asked for a verification');
    });
    expect(await call({})).toMatchObject({ failed: true, content: expect.stringMatching(/query/) });
    expect(await call({ query: 'kv' })).toMatchObject({ failed: true, content: expect.stringMatching(/verification/) });
  });

  it('where the app cannot search, it says so', async () => {
    const { call } = await rig();
    expect(await call({ query: 'kv' })).toMatchObject({ failed: true });
  });
});

describe('formatResults', () => {
  it('numbers the results and points to web_fetch', () => {
    const text = formatResults('kv cache', [{ title: 'A', url: 'https://a', snippet: 'one' }], 'embedded');
    expect(text).toContain('Results for "kv cache" (embedded)');
    expect(text).toContain('1. A — https://a');
    expect(text).toContain('web_fetch');
  });

  it('says so when nothing came back', () => {
    expect(formatResults('kv cache', [], 'brave')).toMatch(/No results/);
  });
});
