import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from './registry.js';
import type { ToolDef, ToolHandler, ToolInventoryDelta } from './types.js';

const handler: ToolHandler = async () => ({ ok: true, content: '' });

const def = (name: string, extra: Partial<ToolDef> = {}): ToolDef => ({
  name,
  description: `outil ${name}`,
  inputSchema: { type: 'object', properties: {} },
  effect: 'read',
  ...extra,
});

function registry(...names: string[]): ToolRegistry {
  const reg = new ToolRegistry();
  for (const name of names) reg.register(def(name), handler);
  return reg;
}

describe('ToolRegistry — inventaire', () => {
  it('enregistre puis retrouve un outil avec sa source', () => {
    const reg = new ToolRegistry();
    reg.register(def('read_file'), handler, 'mcp');
    const found = reg.get('read_file');
    expect(found?.def.name).toBe('read_file');
    expect(found?.source).toBe('mcp');
    expect(found?.handler).toBe(handler);
  });

  it('source builtin par défaut', () => {
    expect(registry('a').get('a')?.source).toBe('builtin');
  });

  it('refuse un nom en double', () => {
    const reg = registry('a');
    expect(() => reg.register(def('a'), handler)).toThrow(/déjà/);
  });

  it('list trie par nom', () => {
    expect(registry('zeta', 'alpha', 'milieu').list().map((d) => d.name)).toEqual([
      'alpha',
      'milieu',
      'zeta',
    ]);
  });

  it('unregister retire l’outil', () => {
    const reg = registry('a', 'b');
    reg.unregister('a');
    expect(reg.get('a')).toBeUndefined();
    expect(reg.list().map((d) => d.name)).toEqual(['b']);
  });

  it('unregister d’un inconnu ne lève pas', () => {
    expect(() => registry().unregister('fantome')).not.toThrow();
  });
});

describe('ToolRegistry — empreinte', () => {
  it('même inventaire, ordre d’enregistrement différent ⇒ même empreinte', () => {
    expect(registry('a', 'b').snapshot().hash).toBe(registry('b', 'a').snapshot().hash);
  });

  it('un outil ajouté change l’empreinte', () => {
    expect(registry('a').snapshot().hash).not.toBe(registry('a', 'b').snapshot().hash);
  });

  it('un schéma modifié change l’empreinte (même nom)', () => {
    const before = registry('a').snapshot().hash;
    const reg = new ToolRegistry();
    reg.register(def('a', { inputSchema: { type: 'object', properties: { x: {} } } }), handler);
    expect(reg.snapshot().hash).not.toBe(before);
  });

  it('snapshot expose les noms triés', () => {
    expect(registry('b', 'a').snapshot().names).toEqual(['a', 'b']);
  });
});

describe('ToolRegistry — diff', () => {
  it('détecte les ajouts avec leur définition complète', () => {
    const before = registry('a').snapshot();
    const reg = registry('a', 'b');
    const delta = reg.diff(before);
    expect(delta.removed).toEqual([]);
    expect(delta.added.map((d) => d.name)).toEqual(['b']);
    expect(delta.added[0]!.description).toBe('outil b');
  });

  it('détecte les retraits par nom', () => {
    const before = registry('a', 'b').snapshot();
    const delta = registry('a').diff(before);
    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual(['b']);
  });

  it('inventaire inchangé ⇒ delta vide', () => {
    const reg = registry('a', 'b');
    expect(reg.diff(reg.snapshot())).toEqual({ added: [], removed: [] });
  });
});

describe('ToolRegistry — notifications', () => {
  it('notifie à l’enregistrement et au retrait', () => {
    const reg = new ToolRegistry();
    const seen: ToolInventoryDelta[] = [];
    reg.onChange((delta) => seen.push(delta));

    reg.register(def('a'), handler);
    reg.unregister('a');

    expect(seen).toHaveLength(2);
    expect(seen[0]!.added.map((d) => d.name)).toEqual(['a']);
    expect(seen[1]!.removed).toEqual(['a']);
  });

  it('unregister d’un inconnu ne notifie pas', () => {
    const reg = new ToolRegistry();
    const listener = vi.fn();
    reg.onChange(listener);
    reg.unregister('fantome');
    expect(listener).not.toHaveBeenCalled();
  });

  it('la désinscription arrête les notifications', () => {
    const reg = new ToolRegistry();
    const listener = vi.fn();
    reg.onChange(listener)();
    reg.register(def('a'), handler);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('ToolRegistry — grammaire', () => {
  it('reflète l’inventaire courant', () => {
    const reg = registry('read_file');
    expect(reg.grammar()?.grammar).toContain('read_file');
  });

  it('un outil retiré disparaît de la grammaire (donc inémettable)', () => {
    const reg = registry('read_file', 'run_shell');
    reg.unregister('run_shell');
    const grammar = reg.grammar()!.grammar;
    expect(grammar).toContain('read_file');
    expect(grammar).not.toContain('run_shell');
  });

  it('aucun outil ⇒ aucune contrainte', () => {
    expect(registry().grammar()).toBeNull();
  });
});
