import { describe, expect, it } from 'vitest';
import { BackendRegistry, type BackendType } from './registry.js';

function type(id: string): BackendType {
  return {
    id,
    label: id,
    create: () => {
      throw new Error('non utilisé dans ces tests');
    },
  };
}

describe('BackendRegistry', () => {
  it('enregistre puis retrouve un type', () => {
    const registry = new BackendRegistry();
    registry.register(type('llamacpp'));
    expect(registry.get('llamacpp').id).toBe('llamacpp');
  });

  it('refuse un id en double', () => {
    const registry = new BackendRegistry();
    registry.register(type('llamacpp'));
    expect(() => registry.register(type('llamacpp'))).toThrow(/déjà enregistré/);
  });

  it('get lève une erreur claire pour un type inconnu', () => {
    const registry = new BackendRegistry();
    expect(() => registry.get('fantome')).toThrow(/fantome/);
  });

  it('unregister retire le type (un plugin désactivé disparaît)', () => {
    const registry = new BackendRegistry();
    registry.register(type('futur-plugin'));
    registry.unregister('futur-plugin');
    expect(() => registry.get('futur-plugin')).toThrow();
  });

  it('list retourne les types triés par id', () => {
    const registry = new BackendRegistry();
    registry.register(type('zeta'));
    registry.register(type('llamacpp'));
    expect(registry.list().map((t) => t.id)).toEqual(['llamacpp', 'zeta']);
  });
});
