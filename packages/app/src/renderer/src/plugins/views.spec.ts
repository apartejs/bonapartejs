import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPluginView, pluginsWithViews } from './views.js';

/**
 * Le glob de `views.ts` a une défaillance SILENCIEUSE : s'il vise le mauvais
 * dossier, il ne ramasse rien, ne lève rien, et chaque onglet de plugin
 * affiche « cette vue n'a pas pu être chargée » à l'exécution. C'est
 * exactement ce qui est arrivé pendant tout J3 — un `../` manquant.
 *
 * Ces tests comparent donc le glob au DISQUE : ils ne peuvent pas passer
 * avec un glob qui ne trouve rien, ni rester verts si un plugin est ajouté
 * sans que le bundle le voie.
 */

const pluginsDir = fileURLToPath(new URL('../../../../../../plugins', import.meta.url));

function pluginsWithRendererOnDisk(): string[] {
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => readdirSync(join(pluginsDir, name)).includes('renderer.tsx'))
    .sort();
}

describe('résolution des vues de plugins', () => {
  it('ramasse au moins une vue (le glob ne vise pas dans le vide)', () => {
    expect(pluginsWithViews().length).toBeGreaterThan(0);
  });

  it('ramasse exactement les plugins qui ont un renderer.tsx sur le disque', () => {
    expect(pluginsWithViews().sort()).toEqual(pluginsWithRendererOnDisk());
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
