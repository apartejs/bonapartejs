/**
 * The one registry of tools: what the model is told of (an inventory whose
 * fingerprint does not depend on the order of registration, and whose change
 * is a delta), and the one way a tool runs. The tools that write or run
 * something pass one at a time per conversation, in the order they were
 * started; reads never wait for them. A failure is a result the model reads,
 * never an exception; an output too long is cut.
 */

import { describe, expect, it } from 'vitest';
import { ToolRegistry, type ToolContext } from './registry.js';
import type { ToolDef } from './types.js';

function def(name: string, effect: ToolDef['effect'] = 'read', extra: Partial<ToolDef> = {}): ToolDef {
  return {
    name,
    description: `The ${name} tool.`,
    inputSchema: { type: 'object', properties: {} },
    effect,
    source: 'builtin',
    where: 'core',
    ...extra,
  };
}

const ok = async () => ({ content: 'ok' });

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return { conversationId: 'c1', roots: [], nCtx: 8_192, signal: new AbortController().signal, ...overrides };
}

describe('ToolRegistry — the inventory', () => {
  it('registers a tool with its definition, and refuses a second of the same name', () => {
    const registry = new ToolRegistry();
    registry.register(def('read_file'), ok);
    expect(registry.get('read_file')?.def.source).toBe('builtin');
    expect(() => registry.register(def('read_file'), ok)).toThrow(/already registered: read_file/);
  });

  it('lists the tools sorted by name', () => {
    const registry = new ToolRegistry();
    registry.register(def('write_file', 'write'), ok);
    registry.register(def('read_file'), ok);
    expect(registry.list().map((tool) => tool.name)).toEqual(['read_file', 'write_file']);
  });

  it('takes a tool back; an unknown one is no error', () => {
    const registry = new ToolRegistry();
    registry.register(def('read_file'), ok);
    registry.unregister('read_file');
    registry.unregister('never_there');
    expect(registry.get('read_file')).toBeUndefined();
    expect(registry.list()).toEqual([]);
  });

  it('fingerprints the inventory whatever the order of registration', () => {
    const one = new ToolRegistry();
    one.register(def('a'), ok);
    one.register(def('b'), ok);
    const two = new ToolRegistry();
    two.register(def('b'), ok);
    two.register(def('a'), ok);
    expect(one.snapshot().hash).toBe(two.snapshot().hash);
    expect(one.snapshot().names).toEqual(['a', 'b']);
  });

  it('a tool added, or a schema changed, changes the fingerprint', () => {
    const registry = new ToolRegistry();
    registry.register(def('a'), ok);
    const before = registry.snapshot().hash;
    registry.register(def('b'), ok);
    expect(registry.snapshot().hash).not.toBe(before);
    const other = new ToolRegistry();
    other.register(def('a', 'read', { inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }), ok);
    expect(other.snapshot().hash).not.toBe(before);
  });

  it('says what changed since a snapshot: the tools added, whole, and the names taken back', () => {
    const registry = new ToolRegistry();
    registry.register(def('a'), ok);
    registry.register(def('b'), ok);
    const before = registry.snapshot();
    registry.unregister('a');
    registry.register(def('c', 'write'), ok);
    expect(registry.diff(before)).toEqual({ added: [def('c', 'write')], removed: ['a'] });
    expect(registry.diff(registry.snapshot())).toEqual({ added: [], removed: [] });
  });

  it('tells its listeners of a tool added or taken back, and of nothing else', () => {
    const registry = new ToolRegistry();
    const deltas: unknown[] = [];
    const stop = registry.onChange((delta) => deltas.push(delta));
    registry.register(def('a'), ok);
    registry.unregister('a');
    registry.unregister('a');
    stop();
    registry.register(def('b'), ok);
    expect(deltas).toEqual([
      { added: [def('a')], removed: [] },
      { added: [], removed: ['a'] },
    ]);
  });
});

describe('ToolRegistry — running a tool', () => {
  it('gives the result with the call it answers', async () => {
    const registry = new ToolRegistry();
    registry.register(def('read_file'), async (call) => ({ content: `read ${String((call.input as { path: string }).path)}` }));
    expect(await registry.run({ id: 't1', name: 'read_file', input: { path: 'a.ts' } }, context())).toEqual({
      toolCallId: 't1',
      name: 'read_file',
      content: 'read a.ts',
    });
  });

  it('a tool that fails gives a result the model reads, not an exception', async () => {
    const registry = new ToolRegistry();
    registry.register(def('read_file'), async () => {
      throw new Error('ENOENT: no such file');
    });
    const result = await registry.run({ id: 't1', name: 'read_file', input: {} }, context());
    expect(result).toMatchObject({ toolCallId: 't1', failed: true });
    expect(result.content).toMatch(/read_file failed: ENOENT: no such file/);
  });

  it('a tool nobody registered is a failed result that names it', async () => {
    const result = await new ToolRegistry().run({ id: 't1', name: 'rm_rf', input: {} }, context());
    expect(result).toMatchObject({ failed: true });
    expect(result.content).toMatch(/no tool named rm_rf/i);
  });

  it('cuts an output too long for the context, and says so', async () => {
    const registry = new ToolRegistry();
    registry.register(def('search'), async () => ({ content: 'y'.repeat(20_000) }));
    const result = await registry.run({ id: 't1', name: 'search', input: {} }, context({ nCtx: 8_192 }));
    expect(result.content.length).toBeLessThan(6_300);
    expect(result.content).toMatch(/The output was cut/);
  });

  it('two writes started together on one conversation apply in the order they started; a read does not wait for them', async () => {
    const registry = new ToolRegistry();
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    registry.register(def('edit_file', 'write'), async (call) => {
      const label = String((call.input as { label: string }).label);
      order.push(`${label} starts`);
      if (label === 'first') await held;
      order.push(`${label} ends`);
      return { content: label };
    });
    registry.register(def('read_file'), async () => {
      order.push('read');
      return { content: 'read' };
    });
    const first = registry.run({ id: 't1', name: 'edit_file', input: { label: 'first' } }, context());
    const second = registry.run({ id: 't2', name: 'edit_file', input: { label: 'second' } }, context());
    const read = registry.run({ id: 't3', name: 'read_file', input: {} }, context());
    // The read is done while the first write still holds the second back.
    await read;
    expect(order).toContain('read');
    expect(order).not.toContain('second starts');
    release();
    await Promise.all([first, second]);
    expect(order.filter((step) => step !== 'read')).toEqual(['first starts', 'first ends', 'second starts', 'second ends']);
  });

  it('the writes of two conversations do not wait for each other', async () => {
    const registry = new ToolRegistry();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    registry.register(def('run_command', 'execute'), async (_call, ctx) => {
      if (ctx.conversationId === 'c1') await held;
      return { content: ctx.conversationId };
    });
    const slow = registry.run({ id: 't1', name: 'run_command', input: {} }, context({ conversationId: 'c1' }));
    expect((await registry.run({ id: 't2', name: 'run_command', input: {} }, context({ conversationId: 'c2' }))).content).toBe('c2');
    release();
    await slow;
  });
});
