import { registerDefaultRenderers } from '@aparte/core';
import { setupMarkedProvider } from '@aparte/plugin-marked';
import {
  setupShikiProviderFromHighlighter,
  type ShikiHighlighterLike,
} from '@aparte/plugin-shiki/core';
import { setupStreamingMarkdownProvider } from '@aparte/plugin-streaming-markdown';
import githubDark from '@shikijs/themes/github-dark';
import githubLight from '@shikijs/themes/github-light';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

/**
 * Ce que la lib attend du renderer avant le premier rendu.
 *
 * Deux fournisseurs Markdown, et ce n'est pas une redondance :
 * — `setupStreamingMarkdownProvider` parse SEULEMENT le texte nouveau et
 *   ajoute des nœuds DOM à chaque chunk. Sur un modèle local qui débite
 *   pendant des minutes, re-parser le message entier à chaque token serait
 *   une catastrophe — c'est le fournisseur qui compte pour nous.
 * — `setupMarkedProvider` rend les messages FINIS et re-rendus (réouverture
 *   d'une conversation, message rejoué). Sans lui, l'historique s'afficherait
 *   en Markdown brut alors que le direct serait propre.
 *
 * Sans aucun des deux, `aparteGlobalConfig.renderMarkdown` rend la chaîne
 * INCHANGÉE : le modèle affiche ses astérisques en clair.
 */
export function bootstrapAparte(): void {
  registerDefaultRenderers();
  setupMarkedProvider({ gfm: true, breaks: true });
  setupStreamingMarkdownProvider();
}

/** Thème shiki correspondant au thème de l'app. */
function shikiTheme(theme: 'dark' | 'light'): string {
  return theme === 'dark' ? 'github-dark' : 'github-light';
}

/**
 * Construit une seule fois : les grammaires sont figées, seul le thème varie
 * ensuite. Le moteur de regex JS évite le WASM d'oniguruma (~620 ko), et les
 * grammaires elles-mêmes (~2 Mo) sont importées dynamiquement pour rester
 * hors du morceau chargé au démarrage.
 */
let highlighter: Promise<ShikiHighlighterLike> | null = null;

function ensureHighlighter(): Promise<ShikiHighlighterLike> {
  highlighter ??= import('./shiki-languages.js').then(({ LANGUAGES }) =>
    createHighlighterCore({
      themes: [githubDark, githubLight],
      langs: LANGUAGES,
      engine: createJavaScriptRegexEngine(),
    }),
  );
  return highlighter;
}

/**
 * Coloration syntaxique — séparée parce qu'elle est ASYNCHRONE.
 *
 * On ne bloque PAS le premier rendu là-dessus : sur un agent local, le
 * premier bloc de code arrive de toute façon des secondes après le
 * démarrage, et un échec doit donner du code non colorisé, jamais un écran
 * blanc.
 *
 * Rappelable : changer de thème ré-enregistre le fournisseur sans
 * reconstruire le highlighter (les deux thèmes y sont déjà).
 */
export async function bootstrapHighlighting(
  theme: 'dark' | 'light',
): Promise<void> {
  setupShikiProviderFromHighlighter(await ensureHighlighter(), {
    theme: shikiTheme(theme),
  });
}
