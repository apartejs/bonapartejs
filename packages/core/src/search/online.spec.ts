/**
 * Web search — the pure parts: what a search engine's page yields once
 * normalised, what an online provider is asked and how its answer is read,
 * and how results and pages are written for the model.
 *
 * The embedded searcher itself drives a hidden Electron window; it is
 * proven on the real machine, not here.
 */

import { describe, expect, it } from 'vitest';
import {
  normalizeEmbeddedResults,
  onlineRequest,
  parseOnlineResponse,
} from './online.js';

describe('the embedded engine’s page, normalised', () => {
  it('unwraps DuckDuckGo’s redirect links, drops what has no URL, and caps the count', () => {
    const raw = [
      {
        title: 'Slot save',
        href: '//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fggml%2Dorg%2Fllama.cpp%2Fdiscussions%2F9781&rut=abc',
        snippet: '  Someone asked …  ',
      },
      { title: 'Direct', href: 'https://example.org/page', snippet: 'Plain link.' },
      { title: 'Broken', href: '', snippet: 'no url' },
      { title: 'Third', href: 'https://example.org/3', snippet: '' },
    ];

    const results = normalizeEmbeddedResults(raw, 2);

    expect(results).toEqual([
      {
        title: 'Slot save',
        url: 'https://github.com/ggml-org/llama.cpp/discussions/9781',
        snippet: 'Someone asked …',
      },
      { title: 'Direct', url: 'https://example.org/page', snippet: 'Plain link.' },
    ]);
  });

  it('keeps one entry per URL', () => {
    const raw = [
      { title: 'A', href: 'https://example.org/a', snippet: '' },
      { title: 'A again', href: 'https://example.org/a', snippet: '' },
    ];
    expect(normalizeEmbeddedResults(raw, 10)).toHaveLength(1);
  });
});

describe('online providers', () => {
  it('asks Brave with its header, and reads its web results', () => {
    const request = onlineRequest('brave', 'kv cache', 3, { apiKey: 'k' });
    expect(request.url).toContain('https://api.search.brave.com/res/v1/web/search?');
    expect(request.url).toContain('q=kv+cache');
    expect(request.url).toContain('count=3');
    expect((request.init.headers as Record<string, string>)['X-Subscription-Token']).toBe('k');

    expect(
      parseOnlineResponse('brave', {
        web: { results: [{ title: 'T', url: 'https://x.y/z', description: 'D' }] },
      }),
    ).toEqual([{ title: 'T', url: 'https://x.y/z', snippet: 'D' }]);
  });

  it('asks Tavily and Serper with a JSON body, and reads their shapes', () => {
    const tavily = onlineRequest('tavily', 'q', 5, { apiKey: 'k' });
    expect(tavily.url).toBe('https://api.tavily.com/search');
    expect(JSON.parse(tavily.init.body as string)).toMatchObject({ api_key: 'k', query: 'q', max_results: 5 });
    expect(
      parseOnlineResponse('tavily', { results: [{ title: 'T', url: 'https://t', content: 'C' }] }),
    ).toEqual([{ title: 'T', url: 'https://t', snippet: 'C' }]);

    const serper = onlineRequest('serper', 'q', 5, { apiKey: 'k' });
    expect(serper.url).toBe('https://google.serper.dev/search');
    expect((serper.init.headers as Record<string, string>)['X-API-KEY']).toBe('k');
    expect(
      parseOnlineResponse('serper', { organic: [{ title: 'T', link: 'https://s', snippet: 'S' }] }),
    ).toEqual([{ title: 'T', url: 'https://s', snippet: 'S' }]);
  });

  it('asks a SearXNG instance for JSON at its base URL, and reads it', () => {
    const request = onlineRequest('searxng', 'q', 4, { searxngUrl: 'http://localhost:8080/' });
    expect(request.url).toBe('http://localhost:8080/search?q=q&format=json');
    expect(
      parseOnlineResponse('searxng', { results: [{ title: 'T', url: 'https://x', content: 'C' }] }),
    ).toEqual([{ title: 'T', url: 'https://x', snippet: 'C' }]);
  });

  it('refuses to ask a provider that lacks what it needs, and says which setting', () => {
    expect(() => onlineRequest('brave', 'q', 3, {})).toThrow(/API key/);
    expect(() => onlineRequest('searxng', 'q', 3, {})).toThrow(/SearXNG URL/);
    expect(() => onlineRequest('nope' as never, 'q', 3, {})).toThrow(/Unknown search provider/);
  });
});
