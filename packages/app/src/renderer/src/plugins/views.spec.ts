import { describe, expect, it } from 'vitest';
import { loadPluginView, pluginsWithViews } from './views.js';

/**
 * Le glob de `views.ts` a une défaillance SILENCIEUSE : s'il vise le mauvais
 * dossier, il ne ramasse rien, ne lève rien, et chaque onglet de plugin
 * affiche « cette vue n'a pas pu être chargée » à l'exécution. C'est
 * exactement ce qui est arrivé pendant tout J3 — un `../` manquant.
 *
 * On compare donc le bundle aux MANIFESTES, qui sont la source de vérité :
 * tout plugin déclarant `entry.renderer` doit voir sa vue résolue ici.
 * Le test « au moins une vue » ancre le chemin de base — sans lui, deux globs
 * également faux se compareraient à vide et passeraient.
 */

interface Manifest {
  id: string;
  entry?: { renderer?: string };
}

const manifests = import.meta.glob('../../../../../../plugins/*/plugin.json', {
  eager: true,
  import: 'default',
}) as Record<string, Manifest>;

function pluginsDeclaringAView(): string[] {
  return Object.values(manifests)
    .filter((manifest) => manifest.entry?.renderer)
    .map((manifest) => manifest.id)
    .sort();
}

describe('résolution des vues de plugins', () => {
  it('ramasse au moins une vue (le glob ne vise pas dans le vide)', () => {
    expect(pluginsWithViews().length).toBeGreaterThan(0);
  });

  it('ramasse exactement les plugins dont le manifeste déclare une vue', () => {
    expect(pluginsWithViews().sort()).toEqual(pluginsDeclaringAView());
  });

  it('charge réellement le composant de chaque vue', async () => {
    for (const id of pluginsWithViews()) {
      const view = await loadPluginView(id);
      expect(view, `la vue du plugin ${id} n'a pas pu être chargée`).toBeTypeOf(
        'function',
      );
    }
  });

  it('rend null pour un plugin sans vue, sans lever', async () => {
    await expect(loadPluginView('plugin-qui-nexiste-pas')).resolves.toBeNull();
  });
});
