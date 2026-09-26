/**
 * Web search — Node half (main process).
 *
 * Two tools for the model: `web_search` (a query, the top results) and
 * `web_fetch` (a URL, its readable text). The search runs through the
 * provider chosen in the settings: embedded by default — a hidden browser
 * and a public engine, no key, no account — or one of the online APIs once
 * chosen. Reading a page always goes through the hidden browser.
 *
 * Both tools declare the `network` effect: nothing on this machine
 * changes, but the query or the URL leaves it — which Reading and
 * Rehearsal ask about first (Q-23).
 */

import { definePlugin, type PluginNodeContext } from '@aparte/bonaparte-plugin-sdk';
import { HiddenPage } from './embedded.js';
import {
  formatPage,
  formatResults,
  searchOnline,
  type OnlineProvider,
  type SearchProvider,
} from './providers.js';

const DEFAULT_MAX = 6;
const ONLINE: OnlineProvider[] = ['brave', 'tavily', 'serper', 'searxng'];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default definePlugin({
  activate(ctx: PluginNodeContext) {
    const page = new HiddenPage();
    ctx.onDispose(() => page.dispose());

    const provider = (): SearchProvider => {
      const chosen = ctx.getConfig<string>('provider');
      return chosen && (ONLINE as string[]).includes(chosen) ? (chosen as OnlineProvider) : 'embedded';
    };

    ctx.registerToolHandler('web_search', async ({ args }) => {
      const query = typeof args['query'] === 'string' ? args['query'].trim() : '';
      if (!query) return { ok: false, content: 'Argument "query" is required.' };
      const requested = typeof args['maxResults'] === 'number' ? Math.round(args['maxResults']) : DEFAULT_MAX;
      const max = Math.min(10, Math.max(1, requested));
      const chosen = provider();
      try {
        const results =
          chosen === 'embedded'
            ? await page.search(query, max)
            : await searchOnline(chosen, query, max, {
                apiKey: ctx.getConfig<string>('apiKey'),
                searxngUrl: ctx.getConfig<string>('searxngUrl'),
              });
        ctx.log(`web_search (${chosen}): "${query}" → ${results.length} result(s)`);
        return { ok: true, content: formatResults(query, results, chosen) };
      } catch (error) {
        return { ok: false, content: `Search failed (${chosen}): ${message(error)}` };
      }
    });

    ctx.registerToolHandler('web_fetch', async ({ args }) => {
      const url = typeof args['url'] === 'string' ? args['url'].trim() : '';
      if (!url) return { ok: false, content: 'Argument "url" is required.' };
      try {
        const text = await page.read(url);
        ctx.log(`web_fetch: ${text.url} (${text.text.length} chars)`);
        return { ok: true, content: formatPage(text) };
      } catch (error) {
        return { ok: false, content: `Could not read ${url}: ${message(error)}` };
      }
    });
  },
});
