/**
 * The built-in browser's Node half (task 10.1): its tools ask the app's browser (the context's `browser`) and
 * write what came back for the model. A failure is a result the model reads, never an exception; the page's
 * text reaches the model as text — the core neutralises the template's control tokens in every tool result.
 */

import { definePlugin, type BrowserAction, type BrowserConsoleLine } from '@aparte/bonaparte-plugin-sdk';

const UNAVAILABLE = { content: 'The built-in browser is not available here.', failed: true } as const;
const NO_PAGE = { content: 'No page is open in the browser: open one with browser_open.', failed: true } as const;

function consoleText(lines: readonly BrowserConsoleLine[]): string {
  const errors = lines.filter((line) => line.level === 'error').length;
  const warnings = lines.filter((line) => line.level === 'warning').length;
  const shown = [...lines.filter((line) => line.level === 'error'), ...lines.filter((line) => line.level !== 'error')].slice(0, 40);
  const head = `Console: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`;
  return shown.length === 0 ? `${head}.` : `${head}:\n${shown.map((line) => `[${line.level}] ${line.text}${line.source && line.source !== ':' ? ` (${line.source})` : ''}`).join('\n')}`;
}

function actionOf(input: Record<string, unknown>): BrowserAction | null {
  const selector = typeof input['selector'] === 'string' ? input['selector'].trim() : '';
  switch (input['action']) {
    case 'click':
      return selector ? { kind: 'click', selector } : null;
    case 'type':
      return selector ? { kind: 'type', selector, text: typeof input['text'] === 'string' ? input['text'] : '' } : null;
    case 'scroll':
      return { kind: 'scroll', by: typeof input['by'] === 'number' && Number.isFinite(input['by']) ? input['by'] : 600 };
    default:
      return null;
  }
}

export const browser = definePlugin({
  activate(ctx) {
    ctx.registerToolHandler('browser_open', async ({ input }) => {
      if (!ctx.browser) return UNAVAILABLE;
      const url = typeof (input as { url?: unknown })?.url === 'string' ? (input as { url: string }).url.trim() : '';
      if (!url) return { content: 'Argument "url" is required: the address to open.', failed: true };
      const opened = await ctx.browser.open(url);
      if ('error' in opened) return { content: `Could not open ${url}: ${opened.error}`, failed: true };
      return { content: `Opened ${opened.url} (${opened.title || 'untitled'}) in the browser.` };
    });

    ctx.registerToolHandler('browser_read', async () => {
      if (!ctx.browser) return UNAVAILABLE;
      const page = await ctx.browser.read();
      if (!page) return NO_PAGE;
      return { content: `${page.title || 'Untitled'} — ${page.url}\n\n${page.text.trim()}\n\n${consoleText(page.console)}` };
    });

    ctx.registerToolHandler('browser_screenshot', async () => {
      if (!ctx.browser) return UNAVAILABLE;
      const shot = await ctx.browser.screenshot();
      if (!shot) return NO_PAGE;
      return {
        content: `A screenshot of ${shot.url} (${shot.width} × ${shot.height}) was taken and kept for the person (${shot.saved}); you cannot see it — read the page with browser_read.`,
      };
    });

    ctx.registerToolHandler('browser_act', async ({ input }) => {
      if (!ctx.browser) return UNAVAILABLE;
      const action = actionOf((input ?? {}) as Record<string, unknown>);
      if (!action) return { content: 'Give "action": click or type (with a "selector"), or scroll.', failed: true };
      const result = await ctx.browser.act(action);
      if ('error' in result) return { content: result.error, failed: true };
      return { content: `Done: ${result.done}.` };
    });
  },
});
