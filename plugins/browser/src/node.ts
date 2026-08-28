/**
 * Tooled browser — Node half (main process).
 *
 * A native `WebContentsView` is placed on top of the window, at the spot
 * the React view tells it to. It's not a DOM element: nothing positions it
 * on its own, it's up to the renderer to send its rectangle on every
 * resize — otherwise the page floats in the wrong place.
 *
 * The point isn't to have a browser, it's for the AGENT to be able to read
 * what it displays: console, DOM, capture. A round trip like "start the
 * server, open the page, tell me the error" becomes possible without
 * copy-pasting.
 *
 * One page PER TAB of the panel. Since the native view sits ON TOP OF the
 * window, an inactive tab's page would cover the visible tab: so it gets
 * removed from the window on teardown, without being destroyed — the tab
 * keeps its URL, its console and its navigation history.
 *
 * RULE: a page only joins the window once we know WHERE to put it. A view
 * placed without a rectangle takes over the whole window and hides the
 * entire application — this happened, and it showed: a URL that failed to
 * load made the open command fail, so the React view never learned it had
 * to send its rectangle, and the page stayed over the whole window. Placing
 * the view only when a rectangle arrives removes this whole class of
 * failure instead of catching it after the fact.
 *
 * The agent's tools target the VISIBLE page (the last attached tab): that's
 * what "the page open in the side browser" means to the user looking at it.
 */

import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, WebContentsView } from 'electron';
import { definePlugin, type PluginNodeContext } from '@aparte/bonaparte-plugin-sdk';

/** Console messages kept: enough to diagnose, not a log. */
const MAX_MESSAGES = 200;
/** How much of the DOM we return — beyond that, we truncate and say so. */
const MAX_DOM_CHARS = 8_000;

interface ConsoleEntry {
  level: string;
  text: string;
  at: string;
}

const LEVELS = ['debug', 'info', 'warning', 'error'];

interface Page {
  view: WebContentsView;
  url: string | null;
  messages: ConsoleEntry[];
  /** Is the native view currently placed on the window? */
  attached: boolean;
}

export default definePlugin({
  activate(ctx: PluginNodeContext) {
    /** One page per tab, indexed by its `instanceId`. */
    const pages = new Map<string, Page>();
    /** The visible tab — the target of the agent's tools. */
    let visibleId: string | null = null;

    const host = (): BrowserWindow | null => BrowserWindow.getAllWindows()[0] ?? null;

    /** The tab, as each command names it. */
    const idOf = (payload: unknown): string =>
      typeof (payload as { instanceId?: unknown } | null)?.instanceId === 'string'
        ? (payload as { instanceId: string }).instanceId
        : '';

    const detach = (page: Page): void => {
      if (!page.attached) return;
      try {
        host()?.contentView.removeChildView(page.view);
      } catch {
        /* window already gone */
      }
      page.attached = false;
    };

    const attach = (page: Page): void => {
      if (page.attached) return;
      host()?.contentView.addChildView(page.view);
      page.attached = true;
    };

    const destroy = (instanceId: string): void => {
      const page = pages.get(instanceId);
      if (!page) return;
      detach(page);
      pages.delete(instanceId);
      if (visibleId === instanceId) visibleId = null;
    };

    // Native views die with the plugin: otherwise they would stay placed
    // on the window, with no one left to move or close them.
    ctx.onDispose(() => {
      for (const instanceId of [...pages.keys()]) destroy(instanceId);
    });

    const ensurePage = (instanceId: string): Page => {
      const existing = pages.get(instanceId);
      if (existing) {
        visibleId = instanceId;
        return existing;
      }

      const created = new WebContentsView({
        webPreferences: {
          // A third-party page has no reason to access Node: the
          // browser is an observation tool, not a door.
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      // Empty rectangle from the start: if anything placed this view on
      // the window before the React view had given it a place, it would
      // be invisible rather than invasive.
      created.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      const page: Page = { view: created, url: null, messages: [], attached: false };
      created.webContents.on('console-message', (_event, level, message) => {
        page.messages.push({
          level: LEVELS[level] ?? String(level),
          text: message,
          at: new Date().toISOString(),
        });
        if (page.messages.length > MAX_MESSAGES) page.messages.shift();
      });
      pages.set(instanceId, page);
      // No `attach` here: it's the arrival of a rectangle that places the view.
      visibleId = instanceId;
      return page;
    };

    /**
     * The page the agent observes: the one being looked at. Absent a
     * visible tab, the only open one — beyond that, the ambiguity is real
     * and we say so rather than pick one at random.
     */
    const agentPage = (): Page | null => {
      if (visibleId) return pages.get(visibleId) ?? null;
      if (pages.size === 1) return [...pages.values()][0] ?? null;
      return null;
    };

    const requirePage = (): Page => {
      const page = agentPage();
      if (!page) {
        throw new Error(
          'No page is open in the side browser. Ask the user to open a Browser tab in the tooling panel.',
        );
      }
      return page;
    };

    ctx.registerCommand('open', async (payload) => {
      const { url } = (payload ?? {}) as { url?: string };
      if (!url) throw new Error('url is required');
      const target = /^https?:\/\//i.test(url) ? url : `http://${url}`;
      const page = ensurePage(idOf(payload));
      page.messages.length = 0;
      page.url = target;
      // A load that fails must NOT make the command fail: the React view
      // is waiting for a response to know it has a page to place. Without
      // this, an unreachable URL left a native view without a rectangle.
      try {
        await page.view.webContents.loadURL(target);
        return { url: target };
      } catch (error) {
        return {
          url: target,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    /** Rectangle sent by the React view: the native view isn't in the DOM. */
    ctx.registerCommand('bounds', async (payload) => {
      const { x, y, width, height } = (payload ?? {}) as Record<string, number>;
      const instanceId = idOf(payload);
      const page = pages.get(instanceId);
      if (!page || !width || !height) {
        // No rectangle, or an empty one: we place nothing, and we REMOVE
        // whatever already is. A view with no place has no reason to be
        // on the window.
        if (page) detach(page);
        return { placed: false };
      }
      // Receiving a rectangle means "I'm on screen": the page joins the
      // window and becomes the target of the agent's tools.
      attach(page);
      visibleId = instanceId;
      page.view.setBounds({
        x: Math.round(x ?? 0),
        y: Math.round(y ?? 0),
        width: Math.round(width),
        height: Math.round(height),
      });
      return { placed: true };
    });

    ctx.registerCommand('state', async (payload) => {
      const page = pages.get(idOf(payload));
      return {
        url: page?.url ?? null,
        open: page !== undefined,
        messages: page?.messages.slice(-40) ?? [],
      };
    });

    /**
     * We leave the tab without closing it: the page stays loaded, but it
     * LEAVES the window — otherwise it would cover the tab we just
     * displayed, since a native view ignores the DOM.
     */
    ctx.registerCommand('detach', async (payload) => {
      const instanceId = idOf(payload);
      const page = pages.get(instanceId);
      if (!page) return { detached: false };
      detach(page);
      if (visibleId === instanceId) visibleId = null;
      return { detached: true };
    });

    ctx.registerCommand('close', async (payload) => {
      destroy(idOf(payload));
      return { closed: true };
    });

    // ── What the agent can do with this page ──────────────────────────

    ctx.registerToolHandler('browser_open', async ({ args }) => {
      const url = typeof args['url'] === 'string' ? args['url'] : '';
      if (!url) return { ok: false, content: 'Argument "url" is required.' };
      const target = /^https?:\/\//i.test(url) ? url : `http://${url}`;
      try {
        // The agent loads into the VISIBLE page. It doesn't open a tab:
        // tabs belong to the user, and a page with no tab to carry it
        // would have neither a place on the window nor anyone to see it.
        const page = requirePage();
        page.messages.length = 0;
        await page.view.webContents.loadURL(target);
        page.url = target;
        return { ok: true, content: `Opened ${target} in the side browser.` };
      } catch (error) {
        return {
          ok: false,
          content: `Could not open ${target}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    });

    ctx.registerToolHandler('browser_console', async () => {
      const page = agentPage();
      if (!page) {
        return {
          ok: false,
          content:
            'No page is open in the side browser. Ask the user to open a Browser tab in the tooling panel.',
        };
      }
      if (page.messages.length === 0) {
        return { ok: true, content: 'The page logged nothing to the console.' };
      }
      return {
        ok: true,
        content: page.messages
          .map((entry) => `[${entry.level}] ${entry.text}`)
          .join('\n'),
      };
    });

    ctx.registerToolHandler('browser_dom', async ({ args }) => {
      const selector = typeof args['selector'] === 'string' ? args['selector'] : 'body';
      try {
        const page = requirePage();
        // The selector is injected as JSON: an apostrophe in a selector
        // must not be able to close the string early and execute
        // something else.
        const html = (await page.view.webContents.executeJavaScript(
          `(() => { const el = document.querySelector(${JSON.stringify(selector)});
            return el ? el.outerHTML : null; })()`,
        )) as string | null;
        if (html === null) {
          return { ok: false, content: `No element matches ${selector}.` };
        }
        return {
          ok: true,
          content:
            html.length > MAX_DOM_CHARS
              ? `${html.slice(0, MAX_DOM_CHARS)}\n… (truncated, ${html.length} characters total)`
              : html,
        };
      } catch (error) {
        return {
          ok: false,
          content: error instanceof Error ? error.message : String(error),
        };
      }
    });

    ctx.registerToolHandler('browser_screenshot', async () => {
      try {
        const page = requirePage();
        const image = await page.view.webContents.capturePage();
        const file = join(tmpdir(), `bonaparte-capture-${Date.now()}.png`);
        await writeFile(file, image.toPNG());
        const size = image.getSize();
        // The path, not the image: the model doesn't see pixels. It's
        // the user who will open the file.
        return {
          ok: true,
          content: `Screenshot saved to ${file} (${size.width}x${size.height}). You cannot see it; describe it to the user only if they open it.`,
        };
      } catch (error) {
        return {
          ok: false,
          content: error instanceof Error ? error.message : String(error),
        };
      }
    });
  },
});
