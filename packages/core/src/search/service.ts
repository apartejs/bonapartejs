/**
 * Searching the web (task 10.4): what the web-search plugin's tool asks. The provider is the person's choice
 * (`webSearchProvider`, `embedded` by default): the public engine the app reads in a hidden page — no key, no
 * account, only the query leaves the machine — or an online API whose key lives in the vault, never in a
 * setting. A SearXNG at a local or private address is refused, as `web_fetch` refuses one.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicAddress } from '../tools/builtin/web-fetch.js';
import {
  normalizeEmbeddedResults,
  searchOnline,
  type OnlineProvider,
  type RawResult,
  type SearchProvider,
  type SearchResult,
} from './online.js';

/** The hidden page of the main process: the public engine's results, as its page shows them. */
export type EmbeddedSearch = (query: string, max: number, signal?: AbortSignal) => Promise<RawResult[]>;

export class NoSearchEngineError extends Error {
  constructor() {
    super('No search engine is available here: the app reads the public engine in a hidden page, which this run does not have.');
    this.name = 'NoSearchEngineError';
  }
}

export interface WebSearchDeps {
  embedded?: EmbeddedSearch;
  provider(): Promise<SearchProvider>;
  /** An online provider's key, from the vault. */
  key(provider: OnlineProvider): Promise<string | undefined>;
  searxngUrl(): Promise<string>;
  fetch?: typeof globalThis.fetch;
  lookup?: (host: string) => Promise<string[]>;
}

export interface WebSearch {
  search(query: string, max: number, signal?: AbortSignal): Promise<{ provider: SearchProvider; results: SearchResult[] }>;
}

export function createWebSearch(deps: WebSearchDeps): WebSearch {
  const resolve = deps.lookup ?? (async (host: string) => (await dnsLookup(host, { all: true })).map((found) => found.address));

  async function refusePrivate(address: string): Promise<void> {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      throw new Error(`The SearXNG URL is not an address: ${address}`);
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [host] : await resolve(host).catch(() => []);
    if (addresses.length === 0 || addresses.some((one) => !isPublicAddress(one))) {
      throw new Error(`Refused: the SearXNG URL ${url.host} is a local or private address. Only addresses of the internet are searched.`);
    }
  }

  return {
    async search(query, max, signal) {
      const provider = await deps.provider();
      if (provider === 'embedded') {
        if (!deps.embedded) throw new NoSearchEngineError();
        return { provider, results: normalizeEmbeddedResults(await deps.embedded(query, max, signal), max) };
      }
      const config = provider === 'searxng' ? { searxngUrl: await deps.searxngUrl() } : { apiKey: (await deps.key(provider)) ?? '' };
      if (provider === 'searxng' && config.searxngUrl) await refusePrivate(config.searxngUrl);
      return { provider, results: await searchOnline(provider, query, max, config, deps.fetch ?? globalThis.fetch, signal) };
    },
  };
}
