/**
 * Web search — the pure parts.
 *
 * Two families of providers. The EMBEDDED one is a hidden browser that
 * queries a public engine and reads its result page: nothing leaves the
 * machine but the query, no key, no account — the default. The ONLINE ones
 * (Brave, Tavily, Serper, a SearXNG instance) are HTTP APIs behind a key or
 * a URL: present in the settings, inactive until chosen.
 *
 * This module never touches the network or a window: it builds requests,
 * reads answers and writes for the model. The specs cover it entirely.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type OnlineProvider = 'brave' | 'tavily' | 'serper' | 'searxng';
export type SearchProvider = 'embedded' | OnlineProvider;

/** What the hidden window's extraction script hands back, per result. */
export interface RawResult {
  title: string;
  href: string;
  snippet: string;
}

/** The DuckDuckGo HTML endpoint wraps every link in a redirect carrying the real URL. */
function unwrapRedirect(href: string): string {
  const match = /[?&]uddg=([^&]+)/.exec(href);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return '';
    }
  }
  if (href.startsWith('//')) return `https:${href}`;
  return /^https?:\/\//i.test(href) ? href : '';
}

export function normalizeEmbeddedResults(raw: RawResult[], max: number): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const entry of raw) {
    const url = unwrapRedirect(entry.href.trim());
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: entry.title.trim(), url, snippet: entry.snippet.trim() });
    if (out.length >= max) break;
  }
  return out;
}

export interface OnlineConfig {
  apiKey?: string | undefined;
  searxngUrl?: string | undefined;
}

export interface OnlineRequest {
  url: string;
  init: RequestInit;
}

/** The request an online provider is asked. Throws, naming the setting, when it lacks what it needs. */
export function onlineRequest(
  provider: OnlineProvider,
  query: string,
  max: number,
  config: OnlineConfig,
): OnlineRequest {
  const needKey = (): string => {
    const key = config.apiKey?.trim();
    if (!key) throw new Error(`The ${provider} provider needs an API key: set it in the Web search settings.`);
    return key;
  };
  switch (provider) {
    case 'brave': {
      const key = needKey();
      const params = new URLSearchParams({ q: query, count: String(max) });
      return {
        url: `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
        init: { headers: { Accept: 'application/json', 'X-Subscription-Token': key } },
      };
    }
    case 'tavily': {
      const key = needKey();
      return {
        url: 'https://api.tavily.com/search',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ api_key: key, query, max_results: max, search_depth: 'basic' }),
        },
      };
    }
    case 'serper': {
      const key = needKey();
      return {
        url: 'https://google.serper.dev/search',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-API-KEY': key },
          body: JSON.stringify({ q: query, num: max }),
        },
      };
    }
    case 'searxng': {
      const base = config.searxngUrl?.trim().replace(/\/+$/, '');
      if (!base) throw new Error('The SearXNG provider needs the SearXNG URL: set it in the Web search settings.');
      const params = new URLSearchParams({ q: query, format: 'json' });
      return { url: `${base}/search?${params.toString()}`, init: { headers: { Accept: 'application/json' } } };
    }
    default:
      throw new Error(`Unknown search provider: ${String(provider)}.`);
  }
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Reads a provider's answer into results. An unexpected shape yields nothing, not a crash. */
export function parseOnlineResponse(provider: OnlineProvider, body: unknown): SearchResult[] {
  const record = (body ?? {}) as Record<string, unknown>;
  const list = (items: unknown, title: string, url: string, snippet: string): SearchResult[] =>
    Array.isArray(items)
      ? items
          .map((item) => {
            const entry = (item ?? {}) as Record<string, unknown>;
            return { title: str(entry[title]), url: str(entry[url]), snippet: str(entry[snippet]) };
          })
          .filter((result) => result.url)
      : [];
  switch (provider) {
    case 'brave':
      return list((record['web'] as Record<string, unknown> | undefined)?.['results'], 'title', 'url', 'description');
    case 'tavily':
      return list(record['results'], 'title', 'url', 'content');
    case 'serper':
      return list(record['organic'], 'title', 'link', 'snippet');
    case 'searxng':
      return list(record['results'], 'title', 'url', 'content');
    default:
      return [];
  }
}

/** Runs an online search. `fetchFn` is injectable for tests. */
export async function searchOnline(
  provider: OnlineProvider,
  query: string,
  max: number,
  config: OnlineConfig,
  fetchFn: typeof fetch = fetch,
): Promise<SearchResult[]> {
  const request = onlineRequest(provider, query, max, config);
  const response = await fetchFn(request.url, { ...request.init, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${provider} answered ${response.status}: ${text.slice(0, 200)}`);
  }
  return parseOnlineResponse(provider, await response.json()).slice(0, max);
}

// ── What the model reads ────────────────────────────────────────────────

export function formatResults(query: string, results: SearchResult[], provider: SearchProvider): string {
  if (results.length === 0) {
    return `No results for "${query}" (${provider}). Try other words, or a more specific query.`;
  }
  const lines = results.map((result, index) => {
    const head = `${index + 1}. ${result.title || result.url} — ${result.url}`;
    return result.snippet ? `${head}\n   ${result.snippet}` : head;
  });
  return `Results for "${query}" (${provider}):\n${lines.join('\n')}\n\nRead a promising one with web_fetch(url).`;
}

export interface PageText {
  title: string;
  url: string;
  text: string;
}

/** How much of a page the model gets — beyond that, the text is cut and says so. */
export const MAX_PAGE_CHARS = 12_000;

export function formatPage(page: PageText, maxChars = MAX_PAGE_CHARS): string {
  const text = page.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const head = `${page.title || page.url} — ${page.url}\n\n`;
  if (text.length <= maxChars) return head + text;
  return `${head}${text.slice(0, maxChars)}\n\n[truncated: ${text.length - maxChars} more characters]`;
}
