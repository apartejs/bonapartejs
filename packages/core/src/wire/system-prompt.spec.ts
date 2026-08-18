import { describe, expect, it } from 'vitest';
import type { ToolDef } from '../tools/types.js';
import {
  buildSystemPrompt,
  renderInventoryDelta,
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
    expect(renderToolInventory([])).toMatch(/aucun outil/i);
  });
});

describe('buildSystemPrompt', () => {
  const base = { projectRoot: 'D:\\projets\\app', tools: [tool('read_file')] };

  it('annonce le projet ouvert', () => {
    expect(buildSystemPrompt(base)).toContain('D:\\projets\\app');
  });

  it('embarque l’inventaire d’outils', () => {
    expect(buildSystemPrompt(base)).toContain('read_file');
  });

  it('décrit le format d’appel attendu', () => {
    const prompt = buildSystemPrompt(base);
    expect(prompt).toContain('<tool_call>');
    expect(prompt).toContain('</tool_call>');
  });

  it('prévient que l’inventaire peut être amendé plus tard', () => {
    // Sans cette phrase, un delta appendé contredirait le prompt initial.
    expect(buildSystemPrompt(base)).toMatch(/ultérieur|plus tard|amend/i);
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
    expect(message).toMatch(/disponible|ajout/i);
  });

  it('annonce les retraits', () => {
    const message = renderInventoryDelta({ added: [], removed: ['ancien'] })!;
    expect(message).toContain('ancien');
    expect(message).toMatch(/retiré|plus disponible/i);
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
    expect(rendered).toMatch(/échec|erreur/i);
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
