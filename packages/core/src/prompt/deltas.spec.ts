/**
 * What changed since the system prompt was frozen, told to the model as a
 * note appended — never a re-render. Each delta says only what moved, and
 * nothing when nothing did.
 */

import { describe, expect, it } from 'vitest';
import type { ToolDef } from '../tools/types.js';
import {
  renderInstructionsDelta,
  renderInventoryDelta,
  renderPerimeterDelta,
  renderReplyLanguageDelta,
} from './deltas.js';

function tool(name: string, description = `The ${name} tool.`): ToolDef {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    effect: 'read',
    source: 'builtin',
    where: 'core',
  };
}

describe('renderPerimeterDelta', () => {
  it('announces a project opened after the freeze, and the folder relative paths start from', () => {
    const delta = renderPerimeterDelta([], ['C:\\work']);
    expect(delta?.kind).toBe('perimeter');
    expect(delta?.text).toContain('[project update]');
    expect(delta?.text).toContain('- C:\\work  (default for relative paths)');
  });

  it('announces a closed project without claiming the tools are gone', () => {
    const text = renderPerimeterDelta(['C:\\work'], [])!.text;
    expect(text).toContain('closed');
    expect(text).toContain('Your tools still work');
  });

  it('names the folders added and removed', () => {
    const text = renderPerimeterDelta(['C:\\a', 'C:\\b'], ['C:\\a', 'C:\\c'])!.text;
    expect(text).toContain('Added: C:\\c');
    expect(text).toContain('Removed (do not touch them any more): C:\\b');
  });

  it('announces a new order: the first folder is the default', () => {
    expect(renderPerimeterDelta(['C:\\a', 'C:\\b'], ['C:\\b', 'C:\\a'])!.text).toContain('- C:\\b  (default for relative paths)');
  });

  it('says nothing when nothing moved', () => {
    expect(renderPerimeterDelta(['C:\\a'], ['C:\\a'])).toBeNull();
    expect(renderPerimeterDelta([], [])).toBeNull();
  });
});

describe('renderInventoryDelta', () => {
  it('announces the tools added, with what they take', () => {
    const delta = renderInventoryDelta([tool('read_file')], [tool('read_file'), tool('search')]);
    expect(delta?.kind).toBe('inventory');
    expect(delta?.text).toContain('[tool inventory update]');
    expect(delta?.text).toContain('- search: The search tool.');
    expect(delta?.text).toContain('"required":["path"]');
  });

  it('announces the tools removed, and says not to call them', () => {
    expect(renderInventoryDelta([tool('read_file'), tool('search')], [tool('read_file')])!.text).toContain(
      'Tools removed (do not call them): search',
    );
  });

  it('announces a tool whose definition changed as available again, with its new definition', () => {
    const text = renderInventoryDelta([tool('search')], [tool('search', 'Searches the code.')])!.text;
    expect(text).toContain('- search: Searches the code.');
    expect(text).not.toContain('removed');
  });

  it('says it all in one message, and nothing when nothing moved', () => {
    const text = renderInventoryDelta([tool('a')], [tool('b')])!.text;
    expect(text.match(/\[tool inventory update\]/g)).toHaveLength(1);
    expect(text).toContain('- b: The b tool.');
    expect(text).toContain('Tools removed (do not call them): a');
    expect(renderInventoryDelta([tool('a')], [tool('a')])).toBeNull();
  });
});

describe('renderInstructionsDelta', () => {
  it('gives the new instructions in full when they changed', () => {
    const delta = renderInstructionsDelta('Use npm.', 'Use pnpm.');
    expect(delta?.kind).toBe('instructions');
    expect(delta?.text).toContain('The project instructions changed. They now read:\nUse pnpm.');
  });

  it('says when they no longer exist, and nothing when they did not move', () => {
    expect(renderInstructionsDelta('Use npm.', undefined)!.text).toContain('no longer exist');
    expect(renderInstructionsDelta('Use npm.', 'Use npm.')).toBeNull();
    expect(renderInstructionsDelta(undefined, undefined)).toBeNull();
  });
});

describe('renderReplyLanguageDelta', () => {
  it('asks for the new reply language, and says nothing when it did not change', () => {
    const delta = renderReplyLanguageDelta('French', 'English');
    expect(delta).toEqual({ kind: 'reply-language', text: '[preferences update]\nWrite your replies to the person in English.' });
    expect(renderReplyLanguageDelta('French', 'French')).toBeNull();
  });
});

describe('the deltas', () => {
  it('write English only', () => {
    const texts = [
      renderPerimeterDelta([], ['C:\\work'])!.text,
      renderPerimeterDelta(['C:\\work'], [])!.text,
      renderInventoryDelta([tool('a')], [tool('b')])!.text,
      renderInstructionsDelta('x', undefined)!.text,
      renderReplyLanguageDelta('French', 'English')!.text,
    ];
    for (const text of texts) expect(text).not.toMatch(/[àâçéèêëîïôûùüœ]/i);
  });
});
