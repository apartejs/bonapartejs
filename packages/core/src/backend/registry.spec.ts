import { describe, expect, it } from 'vitest';
import { BackendRegistry, type BackendType } from './registry.js';

function type(id: string): BackendType {
  return {
    id,
    label: id,
    create: () => {
      throw new Error('not used in these tests');
    },
  };
}

describe('BackendRegistry', () => {
  it('registers then retrieves a type', () => {
    const registry = new BackendRegistry();
    registry.register(type('llamacpp'));
    expect(registry.get('llamacpp').id).toBe('llamacpp');
  });

  it('refuses a duplicate id', () => {
    const registry = new BackendRegistry();
    registry.register(type('llamacpp'));
    expect(() => registry.register(type('llamacpp'))).toThrow(/already registered/);
  });

  it('get throws a clear error for an unknown type', () => {
    const registry = new BackendRegistry();
    expect(() => registry.get('fantome')).toThrow(/fantome/);
  });

  it('unregister removes the type (a disabled plugin disappears)', () => {
    const registry = new BackendRegistry();
    registry.register(type('futur-plugin'));
    registry.unregister('futur-plugin');
    expect(() => registry.get('futur-plugin')).toThrow();
  });

  it('list returns the types sorted by id', () => {
    const registry = new BackendRegistry();
    registry.register(type('zeta'));
    registry.register(type('llamacpp'));
    expect(registry.list().map((t) => t.id)).toEqual(['llamacpp', 'zeta']);
  });
});
