import type { ComponentType } from 'react';
import type { ToolingViewProps } from '@aparte/bonaparte-plugin-sdk';

/**
 * Résolution des vues de plugins.
 *
 * Les plugins inclus vivent dans `plugins/<id>/` à la racine du dépôt, avec
 * leur manifeste. Leur point d'entrée renderer est ramassé ici par
 * `import.meta.glob` : Vite en fait des morceaux SÉPARÉS, chargés seulement
 * quand la vue s'affiche. Le manifeste reste la source de vérité (c'est lui
 * qui déclare les onglets) ; ceci ne fait que fournir le composant.
 *
 * Limite assumée et documentée : un plugin TIERS, hors de l'arbre, n'est pas
 * ramassé par ce glob. Le charger demandera un protocole custom Electron et
 * une import map partageant React — le point d'extension est identifié, il
 * n'est pas ouvert en v1 (cf. plan, risque « double React »).
 */
// SIX niveaux : ce fichier est dans packages/app/src/renderer/src/plugins/,
// et `plugins/` est à la RACINE du dépôt. À cinq, on vise `packages/plugins/`,
// qui n'existe pas — le glob ne ramasse alors rien, en silence, et chaque vue
// s'affiche « n'a pas pu être chargée ».
const modules = import.meta.glob('../../../../../../plugins/*/renderer.tsx');

export type ToolingViewComponent = ComponentType<ToolingViewProps>;

/** Charge le composant de vue d'un plugin, ou null s'il n'en fournit pas. */
export async function loadPluginView(
  pluginId: string,
): Promise<ToolingViewComponent | null> {
  const entry = Object.entries(modules).find(([path]) =>
    path.includes(`/plugins/${pluginId}/`),
  );
  if (!entry) return null;
  const loaded = (await entry[1]()) as { default?: ToolingViewComponent };
  return loaded.default ?? null;
}

/** Ids des plugins dont une vue est réellement disponible dans ce bundle. */
export function pluginsWithViews(): string[] {
  return Object.keys(modules)
    .map((path) => /\/plugins\/([^/]+)\//.exec(path)?.[1])
    .filter((id): id is string => Boolean(id));
}
