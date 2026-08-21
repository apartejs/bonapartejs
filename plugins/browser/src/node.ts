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
 *
 * Une page PAR ONGLET du panneau. Comme la vue native se pose PAR-DESSUS la
 * fenêtre, la page d'un onglet inactif recouvrirait l'onglet visible : on la
 * retire donc de la fenêtre au démontage, sans la détruire — l'onglet garde
 * son URL, sa console et son historique de navigation.
 *
 * RÈGLE : une page ne rejoint la fenêtre qu'une fois qu'on sait OÙ la mettre.
 * Une vue posée sans rectangle occupe toute la fenêtre et masque l'application
 * entière — c'est arrivé, et ça s'est vu : une URL qui ne se chargeait pas
 * faisait échouer la commande d'ouverture, donc la vue React n'apprenait
 * jamais qu'elle devait envoyer son rectangle, et la page restait sur toute la
 * fenêtre. Poser la vue seulement quand un rectangle arrive supprime cette
 * classe de panne au lieu de la rattraper.
 *
 * Les outils de l'agent visent la page VISIBLE (le dernier onglet attaché) :
 * c'est ce que « la page ouverte dans le navigateur latéral » veut dire pour
 * l'utilisateur qui la regarde.
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

interface Page {
  view: WebContentsView;
  url: string | null;
  messages: ConsoleEntry[];
  /** La vue native est-elle actuellement posée sur la fenêtre ? */
  attached: boolean;
}

export default definePlugin({
  activate(ctx: PluginNodeContext) {
    /** Une page par onglet, indexée par son `instanceId`. */
    const pages = new Map<string, Page>();
    /** L'onglet visible — la cible des outils de l'agent. */
    let visibleId: string | null = null;

    const host = (): BrowserWindow | null => BrowserWindow.getAllWindows()[0] ?? null;

    /** L'onglet, tel que chaque commande le nomme. */
    const idOf = (payload: unknown): string =>
      typeof (payload as { instanceId?: unknown } | null)?.instanceId === 'string'
        ? (payload as { instanceId: string }).instanceId
        : '';

    const detach = (page: Page): void => {
      if (!page.attached) return;
      try {
        host()?.contentView.removeChildView(page.view);
      } catch {
        /* fenêtre déjà partie */
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

    // Les vues natives meurent avec le plugin : sinon elles resteraient posées
    // sur la fenêtre, sans plus personne pour les déplacer ni les fermer.
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
          // Une page tierce n'a aucune raison d'accéder à Node : le
          // navigateur est un outil d'observation, pas une porte.
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      // Rectangle vide d'emblée : si quoi que ce soit posait cette vue sur la
      // fenêtre avant que la vue React n'ait donné sa place, elle serait
      // invisible plutôt qu'envahissante.
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
      // Pas d'`attach` ici : c'est l'arrivée d'un rectangle qui pose la vue.
      visibleId = instanceId;
      return page;
    };

    /**
     * La page que l'agent observe : celle qu'on regarde. À défaut d'onglet
     * visible, la seule ouverte — au-delà, l'ambiguïté est réelle et on le dit
     * plutôt que de tirer au sort.
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
      if (!url) throw new Error('url requise');
      const target = /^https?:\/\//i.test(url) ? url : `http://${url}`;
      const page = ensurePage(idOf(payload));
      page.messages.length = 0;
      page.url = target;
      // Un chargement qui échoue ne doit PAS faire échouer la commande : la vue
      // React attend une réponse pour savoir qu'elle a une page à placer. Sans
      // ça, une URL injoignable laissait une vue native sans rectangle.
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

    /** Rectangle envoyé par la vue React : la vue native n'est pas dans le DOM. */
    ctx.registerCommand('bounds', async (payload) => {
      const { x, y, width, height } = (payload ?? {}) as Record<string, number>;
      const instanceId = idOf(payload);
      const page = pages.get(instanceId);
      if (!page || !width || !height) {
        // Rectangle absent ou vide : on ne pose rien, et on RETIRE ce qui l'est
        // déjà. Une vue sans place n'a aucune raison d'être sur la fenêtre.
        if (page) detach(page);
        return { placed: false };
      }
      // Recevoir un rectangle veut dire « je suis à l'écran » : la page
      // rejoint la fenêtre et devient la cible des outils de l'agent.
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
     * On quitte l'onglet sans le fermer : la page reste chargée, mais elle
     * QUITTE la fenêtre — sinon elle recouvrirait l'onglet qu'on vient
     * d'afficher, puisqu'une vue native ignore le DOM.
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

    // ── Ce que l'agent peut faire de cette page ──────────────────────────

    ctx.registerToolHandler('browser_open', async ({ args }) => {
      const url = typeof args['url'] === 'string' ? args['url'] : '';
      if (!url) return { ok: false, content: 'Argument "url" is required.' };
      const target = /^https?:\/\//i.test(url) ? url : `http://${url}`;
      try {
        // L'agent charge dans la page VISIBLE. Il n'ouvre pas d'onglet : les
        // onglets appartiennent à l'utilisateur, et une page sans onglet pour
        // la porter n'aurait ni place sur la fenêtre ni personne pour la voir.
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
        // Le sélecteur est injecté en JSON : une apostrophe dans un sélecteur
        // ne doit pas pouvoir refermer la chaîne et exécuter autre chose.
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
