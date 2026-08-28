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

describe('ToolRegistry — inventory', () => {
  it('registers then retrieves a tool with its source', () => {
    const reg = new ToolRegistry();
    reg.register(def('read_file'), handler, 'mcp');
    const found = reg.get('read_file');
    expect(found?.def.name).toBe('read_file');
    expect(found?.source).toBe('mcp');
    expect(found?.handler).toBe(handler);
  });

  it('defaults to builtin source', () => {
    expect(registry('a').get('a')?.source).toBe('builtin');
  });

  it('refuses a duplicate name', () => {
    const reg = registry('a');
    expect(() => reg.register(def('a'), handler)).toThrow(/already/);
  });

  it('list sorts by name', () => {
    expect(registry('zeta', 'alpha', 'milieu').list().map((d) => d.name)).toEqual([
      'alpha',
      'milieu',
      'zeta',
    ]);
  });

  it('unregister removes the tool', () => {
    const reg = registry('a', 'b');
    reg.unregister('a');
    expect(reg.get('a')).toBeUndefined();
    expect(reg.list().map((d) => d.name)).toEqual(['b']);
  });

  it('unregister of an unknown tool does not throw', () => {
    expect(() => registry().unregister('fantome')).not.toThrow();
  });
});

describe('ToolRegistry — fingerprint', () => {
  it('same inventory, different registration order ⇒ same fingerprint', () => {
    expect(registry('a', 'b').snapshot().hash).toBe(registry('b', 'a').snapshot().hash);
  });

  it('an added tool changes the fingerprint', () => {
    expect(registry('a').snapshot().hash).not.toBe(registry('a', 'b').snapshot().hash);
  });

  it('a modified schema changes the fingerprint (same name)', () => {
    const before = registry('a').snapshot().hash;
    const reg = new ToolRegistry();
    reg.register(def('a', { inputSchema: { type: 'object', properties: { x: {} } } }), handler);
    expect(reg.snapshot().hash).not.toBe(before);
  });

  it('snapshot exposes the sorted names', () => {
    expect(registry('b', 'a').snapshot().names).toEqual(['a', 'b']);
  });
});

describe('ToolRegistry — diff', () => {
  it('detects additions with their complete definition', () => {
    const before = registry('a').snapshot();
    const reg = registry('a', 'b');
    const delta = reg.diff(before);
    expect(delta.removed).toEqual([]);
    expect(delta.added.map((d) => d.name)).toEqual(['b']);
    expect(delta.added[0]!.description).toBe('outil b');
  });

  it('detects removals by name', () => {
    const before = registry('a', 'b').snapshot();
    const delta = registry('a').diff(before);
    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual(['b']);
  });

  it('unchanged inventory ⇒ empty delta', () => {
    const reg = registry('a', 'b');
    expect(reg.diff(reg.snapshot())).toEqual({ added: [], removed: [] });
  });
});

describe('ToolRegistry — notifications', () => {
  it('notifies on registration and on removal', () => {
    const reg = new ToolRegistry();
    const seen: ToolInventoryDelta[] = [];
    reg.onChange((delta) => seen.push(delta));

    reg.register(def('a'), handler);
    reg.unregister('a');

    expect(seen).toHaveLength(2);
    expect(seen[0]!.added.map((d) => d.name)).toEqual(['a']);
    expect(seen[1]!.removed).toEqual(['a']);
  });

  it('unregister of an unknown tool does not notify', () => {
    const reg = new ToolRegistry();
    const listener = vi.fn();
    reg.onChange(listener);
    reg.unregister('fantome');
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribing stops the notifications', () => {
    const reg = new ToolRegistry();
    const listener = vi.fn();
    reg.onChange(listener)();
    reg.register(def('a'), handler);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('ToolRegistry — grammar', () => {
  it('reflects the current inventory', () => {
    const reg = registry('read_file');
    expect(reg.grammar()?.grammar).toContain('read_file');
  });

  it('a removed tool disappears from the grammar (hence unemittable)', () => {
    const reg = registry('read_file', 'run_shell');
    reg.unregister('run_shell');
    const grammar = reg.grammar()!.grammar;
    expect(grammar).toContain('read_file');
    expect(grammar).not.toContain('run_shell');
  });

  it('no tool ⇒ no constraint', () => {
    expect(registry().grammar()).toBeNull();
  });
});
