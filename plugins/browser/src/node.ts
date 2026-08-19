/**
 * Navigateur outillé — moitié Node (main process).
 *
 * Une `WebContentsView` native est posée par-dessus la fenêtre, à l'endroit
 * que la vue React lui indique. Ce n'est pas un élément du DOM : rien ne la
 * positionne toute seule, c'est au renderer d'envoyer son rectangle à chaque
 * redimensionnement — sinon la page flotte au mauvais endroit.
 *
 * L'intérêt n'est pas d'avoir un navigateur, c'est que l'AGENT puisse lire ce
 * qu'il affiche : console, DOM, capture. Un aller-retour « lance le serveur,
 * ouvre la page, dis-moi l'erreur » devient possible sans copier-coller.
 */

import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, WebContentsView } from 'electron';
import { definePlugin, type PluginNodeContext } from '@aparte/bonaparte-plugin-sdk';

/** Messages de console conservés : de quoi diagnostiquer, pas un journal. */
const MAX_MESSAGES = 200;
/** Ce qu'on rend du DOM — au-delà, on tronque en le disant. */
const MAX_DOM_CHARS = 8_000;

interface ConsoleEntry {
  level: string;
  text: string;
  at: string;
}

const LEVELS = ['debug', 'info', 'warning', 'error'];

export default definePlugin({
  activate(ctx: PluginNodeContext) {
    let view: WebContentsView | null = null;
    let currentUrl: string | null = null;
    const messages: ConsoleEntry[] = [];

    const host = (): BrowserWindow | null => BrowserWindow.getAllWindows()[0] ?? null;

    const destroy = (): void => {
      const window = host();
      if (view && window) {
        try {
          window.contentView.removeChildView(view);
        } catch {
          /* fenêtre déjà partie */
        }
      }
      view = null;
      currentUrl = null;
    };

    // La vue native meurt avec le plugin : sinon elle resterait posée sur la
    // fenêtre, sans plus personne pour la déplacer ni la fermer.
    ctx.onDispose(destroy);

    const ensureView = (): WebContentsView => {
      if (view) return view;
      const created = new WebContentsView({
        webPreferences: {
          // Une page tierce n'a aucune raison d'accéder à Node : le
          // navigateur est un outil d'observation, pas une porte.
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      created.webContents.on('console-message', (_event, level, message) => {
        messages.push({
          level: LEVELS[level] ?? String(level),
          text: message,
          at: new Date().toISOString(),
        });
        if (messages.length > MAX_MESSAGES) messages.shift();
      });
      host()?.contentView.addChildView(created);
      view = created;
      return created;
    };

    const requireView = (): WebContentsView => {
      if (!view) throw new Error('Aucune page ouverte dans le navigateur latéral.');
      return view;
    };

    ctx.registerCommand('open', async (payload) => {
      const { url } = (payload ?? {}) as { url?: string };
      if (!url) throw new Error('url requise');
      const target = /^https?:\/\//i.test(url) ? url : `http://${url}`;
      messages.length = 0;
      const created = ensureView();
      await created.webContents.loadURL(target);
      currentUrl = target;
      return { url: target };
    });

    /** Rectangle envoyé par la vue React : la vue native n'est pas dans le DOM. */
    ctx.registerCommand('bounds', async (payload) => {
      const { x, y, width, height } = (payload ?? {}) as Record<string, number>;
      if (!view || width === undefined || height === undefined) return { placed: false };
      view.setBounds({
        x: Math.round(x ?? 0),
        y: Math.round(y ?? 0),
        width: Math.round(width),
        height: Math.round(height),
      });
      return { placed: true };
    });

    ctx.registerCommand('state', async () => ({
      url: currentUrl,
      open: view !== null,
      messages: messages.slice(-40),
    }));

    ctx.registerCommand('close', async () => {
      destroy();
      return { closed: true };
    });

    // ── Ce que l'agent peut faire de cette page ──────────────────────────

    ctx.registerToolHandler('browser_open', async ({ args }) => {
      const url = typeof args['url'] === 'string' ? args['url'] : '';
      if (!url) return { ok: false, content: 'Argument "url" is required.' };
      const target = /^https?:\/\//i.test(url) ? url : `http://${url}`;
      try {
        messages.length = 0;
        const created = ensureView();
        await created.webContents.loadURL(target);
        currentUrl = target;
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
      if (!view) {
        return { ok: false, content: 'No page is open in the side browser yet.' };
      }
      if (messages.length === 0) {
        return { ok: true, content: 'The page logged nothing to the console.' };
      }
      return {
        ok: true,
        content: messages
          .map((entry) => `[${entry.level}] ${entry.text}`)
          .join('\n'),
      };
    });

    ctx.registerToolHandler('browser_dom', async ({ args }) => {
      const selector = typeof args['selector'] === 'string' ? args['selector'] : 'body';
      try {
        const page = requireView();
        // Le sélecteur est injecté en JSON : une apostrophe dans un sélecteur
        // ne doit pas pouvoir refermer la chaîne et exécuter autre chose.
        const html = (await page.webContents.executeJavaScript(
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
        const page = requireView();
        const image = await page.webContents.capturePage();
        const file = join(tmpdir(), `bonaparte-capture-${Date.now()}.png`);
        await writeFile(file, image.toPNG());
        const size = image.getSize();
        // Le chemin, pas l'image : le modèle ne voit pas les pixels. C'est
        // l'utilisateur qui ouvrira le fichier.
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
