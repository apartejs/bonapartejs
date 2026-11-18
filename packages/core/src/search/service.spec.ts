import { describe, expect, it } from 'vitest';
import { createWebSearch, NoSearchEngineError } from './service.js';

const raw = [
  { title: ' KV cache ', href: '//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fkv', snippet: ' What it keeps. ' },
  { title: 'Ad', href: '', snippet: '' },
];

describe('searching the web (task 10.4)', () => {
  it('without a key: the public engine the app reads in a hidden page, its results normalised', async () => {
    const asked: [string, number][] = [];
    const search = createWebSearch({
      embedded: async (query, max) => {
        asked.push([query, max]);
        return raw;
      },
      provider: async () => 'embedded',
      key: async () => undefined,
      searxngUrl: async () => '',
    });
    expect(await search.search('kv cache', 3)).toEqual({
      provider: 'embedded',
      results: [{ title: 'KV cache', url: 'https://example.com/kv', snippet: 'What it keeps.' }],
    });
    expect(asked).toEqual([['kv cache', 3]]);
  });

  it('no hidden page on this machine (a test, a command line): said, never a search elsewhere in silence', async () => {
    const search = createWebSearch({ provider: async () => 'embedded', key: async () => undefined, searxngUrl: async () => '' });
    await expect(search.search('kv cache', 3)).rejects.toBeInstanceOf(NoSearchEngineError);
  });

  it('an online provider: its key read from the vault, sent as it asks, never kept anywhere else', async () => {
    const requests: { url: string; headers: Record<string, string> }[] = [];
    const search = createWebSearch({
      provider: async () => 'brave',
      key: async (provider) => (provider === 'brave' ? 'brave-key' : undefined),
      searxngUrl: async () => '',
      fetch: async (input, init) => {
        requests.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
        return new Response(JSON.stringify({ web: { results: [{ title: 'Brave', url: 'https://brave.example', description: 'found' }] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    expect(await search.search('kv cache', 2)).toEqual({
      provider: 'brave',
      results: [{ title: 'Brave', url: 'https://brave.example', snippet: 'found' }],
    });
    expect(requests[0]?.headers['X-Subscription-Token']).toBe('brave-key');
  });

  it('an online provider without its key: said, nothing sent', async () => {
    let sent = 0;
    const search = createWebSearch({
      provider: async () => 'tavily',
      key: async () => undefined,
      searxngUrl: async () => '',
      fetch: async () => {
        sent += 1;
        return new Response('{}');
      },
    });
    await expect(search.search('kv cache', 2)).rejects.toThrow(/API key/);
    expect(sent).toBe(0);
  });

  it('a SearXNG at a local or private address is refused, as web_fetch refuses one', async () => {
    let sent = 0;
    const search = createWebSearch({
      provider: async () => 'searxng',
      key: async () => undefined,
      searxngUrl: async () => 'http://192.168.1.20:8080',
      fetch: async () => {
        sent += 1;
        return new Response('{}');
      },
    });
    await expect(search.search('kv cache', 2)).rejects.toThrow(/local or private address/);
    expect(sent).toBe(0);
  });
});
