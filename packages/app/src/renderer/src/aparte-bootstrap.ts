import { registerDefaultRenderers } from '@aparte/core';
import { setupMarkedProvider } from '@aparte/plugin-marked';
import { setupStreamingMarkdownProvider } from '@aparte/plugin-streaming-markdown';
import { setupShikiProvider } from '@aparte/plugin-shiki';

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
 * Sans aucun des deux, `AparteConfig.renderMarkdown` rend la chaîne
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
 * Coloration syntaxique — séparée parce qu'elle est ASYNCHRONE.
 *
 * shiki importe ses grammaires à la demande : rien n'est embarqué d'avance,
 * on ne paie que les langages réellement affichés, et un langage inconnu
 * retombe en texte brut au lieu de lever. On ne bloque donc PAS le premier
 * rendu là-dessus — et sur un agent local, le premier bloc de code arrive
 * de toute façon des secondes après le démarrage.
 *
 * Rappelable : changer de thème réinstalle le fournisseur.
 */
export async function bootstrapHighlighting(
  theme: 'dark' | 'light',
): Promise<void> {
  await setupShikiProvider({ theme: shikiTheme(theme) });
}
