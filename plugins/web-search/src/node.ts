/**
 * The web search's Node half (task 10.4, ported from v0): the search is the app's — the plugin never sees a
 * key nor opens a page; it checks what the model asks and writes what came back for it to read. A failure is a
 * result the model reads, never an exception.
 */

import { definePlugin, type WebSearchResult } from '@aparte/bonaparte-plugin-sdk';

const DEFAULT_RESULTS = 6;

/** What the model reads of a search: the results numbered, and where to go next. */
export function formatResults(query: string, results: readonly WebSearchResult[], provider: string): string {
  if (results.length === 0) return `No results for "${query}" (${provider}). Try other words, or a more specific query.`;
  const lines = results.map((result, index) => {
    const head = `${index + 1}. ${result.title || result.url} — ${result.url}`;
    return result.snippet ? `${head}\n   ${result.snippet}` : head;
  });
  return `Results for "${query}" (${provider}):\n${lines.join('\n')}\n\nRead a promising one with web_fetch(url).`;
}

export const webSearch = definePlugin({
  activate(ctx) {
    ctx.registerToolHandler('web_search', async ({ input, signal }) => {
      const asked = (input ?? {}) as { query?: unknown; maxResults?: unknown };
      const query = typeof asked.query === 'string' ? asked.query.trim() : '';
      if (!query) return { content: 'Argument "query" is required: what to search for.', failed: true };
      const wanted = typeof asked.maxResults === 'number' && Number.isFinite(asked.maxResults) ? Math.round(asked.maxResults) : DEFAULT_RESULTS;
      const max = Math.min(10, Math.max(1, wanted));
      if (!ctx.search) return { content: 'Web search is not available here.', failed: true };
      try {
        const { provider, results } = await ctx.search(query, max, signal);
        return { content: formatResults(query, results, provider) };
      } catch (error) {
        return { content: `Search failed: ${error instanceof Error ? error.message : String(error)}`, failed: true };
      }
    });
  },
});
