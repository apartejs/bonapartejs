import { describe, expect, it } from 'vitest';
import type { ToolDef } from '../tools/types.js';
import {
  buildSystemPrompt,
  renderInventoryDelta,
  renderPerimeterDelta,
  renderToolInventory,
  renderToolResults,
} from './system-prompt.js';

const tool = (name: string): ToolDef => ({
  name,
  description: `fait ${name}`,
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  effect: 'read',
});

describe('renderToolInventory', () => {
  it('décrit chaque outil avec son nom, sa description et son schéma', () => {
    const rendered = renderToolInventory([tool('read_file')]);
    expect(rendered).toContain('read_file');
    expect(rendered).toContain('fait read_file');
    expect(rendered).toContain('"required"');
  });

  it('sérialise le schéma en JSON valide', () => {
    const rendered = renderToolInventory([tool('a')]);
    const json = rendered.slice(rendered.indexOf('{'), rendered.lastIndexOf('}') + 1);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('rend un inventaire vide explicite', () => {
    expect(renderToolInventory([])).toMatch(/no tools/i);
  });
});

describe('renderPerimeterDelta', () => {
  it('annonce un projet ouvert APRÈS le figeage du prompt', () => {
    // Le prompt système est figé à la création : s'il disait « aucun projet »
    // et qu'un dossier est ouvert ensuite, le modèle n'a aucun moyen de
    // l'apprendre — il continuerait de répondre qu'il ne peut pas lire de
    // fichiers, alors que les outils sont là.
    const message = renderPerimeterDelta([], ['D:/projets/app']);
    expect(message).toBeTruthy();
    expect(message).toContain('D:/projets/app');
  });

  it('annonce la fermeture, sans prétendre que les outils disparaissent', () => {
    // Le projet est le PÉRIMÈTRE, pas la condition d'existence : fermer les
    // dossiers retire le confinement, pas les outils.
    const message = renderPerimeterDelta(['D:/projets/app'], []) ?? '';
    expect(message).toMatch(/still work/i);
    expect(message).not.toMatch(/no longer available/i);
  });

  it('nomme les racines ajoutées et retirées', () => {
    const message = renderPerimeterDelta(['D:/a', 'D:/b'], ['D:/a', 'D:/c']) ?? '';
    expect(message).toMatch(/Added: D:\/c/);
    expect(message).toMatch(/Removed[^\n]*D:\/b/);
  });

  it('annonce un RÉORDONNANCEMENT : la racine par défaut a changé', () => {
    // Même ensemble, autre ordre : les chemins relatifs ne résolvent plus au
    // même endroit. Se taire ici ferait écrire le modèle dans le mauvais dépôt.
    const message = renderPerimeterDelta(['D:/a', 'D:/b'], ['D:/b', 'D:/a']);
    expect(message).toBeTruthy();
    expect(message).toMatch(/default for relative paths/i);
  });

  it('ne dit rien quand rien n’a changé', () => {
    expect(renderPerimeterDelta(['D:/a'], ['D:/a'])).toBeNull();
    expect(renderPerimeterDelta([], [])).toBeNull();
  });

  it('reste en anglais : c’est du protocole, pas de l’interface', () => {
    const message = renderPerimeterDelta([], ['D:/projets/app']) ?? '';
    expect(message).not.toMatch(/[éèàçù]/);
  });
});

describe('buildSystemPrompt', () => {
  const base = { roots: ['D:\\projets\\app'], tools: [tool('read_file')] };

  it('annonce le projet ouvert', () => {
    expect(buildSystemPrompt(base)).toContain('D:\\projets\\app');
  });

  it('avec plusieurs racines, les nomme TOUTES et désigne le défaut', () => {
    // L'ambiguïté des chemins relatifs se résout par de l'information dans le
    // prompt, pas par de la magie dans le résolveur : le modèle doit pouvoir
    // atteindre la deuxième racine sans tâtonner.
    const prompt = buildSystemPrompt({
      roots: ['D:\\a', 'D:\\b'],
      tools: [tool('read_file')],
    });
    expect(prompt).toContain('D:\\a');
    expect(prompt).toContain('D:\\b');
    expect(prompt).toMatch(/default.*relative/i);
    expect(prompt).toMatch(/absolute path/i);
  });

  it('embarque l’inventaire d’outils', () => {
    expect(buildSystemPrompt(base)).toContain('read_file');
  });

  it('décrit le format d’appel attendu', () => {
    const prompt = buildSystemPrompt(base);
    expect(prompt).toContain('<tool_call>');
    expect(prompt).toContain('</tool_call>');
  });

  it('sans projet, annonce que les outils marchent quand même', () => {
    // Le projet est le périmètre des outils, pas leur condition d'existence.
    // Dire l'inverse produisait un modèle qui refusait de lire un fichier.
    const prompt = buildSystemPrompt({ tools: [tool('read_file')] });
    expect(prompt).toMatch(/tools still work/i);
    expect(prompt).not.toMatch(/unavailable/i);
    expect(prompt).not.toMatch(/ask (them|the user) to open/i);
  });

  it('prévient que l’inventaire peut être amendé plus tard', () => {
    // Sans cette phrase, un delta appendé contredirait le prompt initial.
    expect(buildSystemPrompt(base)).toMatch(/amended|later/i);
  });

  it('inclut les consignes de projet quand elles existent', () => {
    const prompt = buildSystemPrompt({
      ...base,
      projectInstructions: 'Toujours utiliser pnpm.',
    });
    expect(prompt).toContain('Toujours utiliser pnpm.');
  });

  it('reste déterministe pour des entrées identiques', () => {
    expect(buildSystemPrompt(base)).toBe(buildSystemPrompt(base));
  });
});

describe('renderInventoryDelta', () => {
  it('annonce les ajouts avec leur schéma', () => {
    const message = renderInventoryDelta({ added: [tool('nouveau')], removed: [] })!;
    expect(message).toContain('nouveau');
    expect(message).toMatch(/available|added/i);
  });

  it('annonce les retraits', () => {
    const message = renderInventoryDelta({ added: [], removed: ['ancien'] })!;
    expect(message).toContain('ancien');
    expect(message).toMatch(/removed/i);
  });

  it('rend null quand rien n’a changé (aucun message inutile appendé)', () => {
    expect(renderInventoryDelta({ added: [], removed: [] })).toBeNull();
  });

  it('combine ajouts et retraits dans un seul message', () => {
    const message = renderInventoryDelta({
      added: [tool('neuf')],
      removed: ['vieux'],
    })!;
    expect(message).toContain('neuf');
    expect(message).toContain('vieux');
  });
});

describe('renderToolResults', () => {
  it('rend le résultat d’un outil en nommant l’outil', () => {
    const rendered = renderToolResults([
      { name: 'read_file', ok: true, content: 'const a = 1;' },
    ]);
    expect(rendered).toContain('read_file');
    expect(rendered).toContain('const a = 1;');
  });

  it('marque explicitement un échec', () => {
    const rendered = renderToolResults([
      { name: 'edit_file', ok: false, content: 'motif ambigu' },
    ]);
    expect(rendered).toMatch(/failed|error/i);
    expect(rendered).toContain('motif ambigu');
  });

  it('rend plusieurs résultats dans l’ordre', () => {
    const rendered = renderToolResults([
      { name: 'a', ok: true, content: 'r1' },
      { name: 'b', ok: true, content: 'r2' },
    ]);
    expect(rendered.indexOf('r1')).toBeLessThan(rendered.indexOf('r2'));
  });
});
