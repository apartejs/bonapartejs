import { describe, expect, it } from 'vitest';
import { parseHermesOutput } from './hermes-parser.js';

const call = (inner: string): string => `<tool_call>${inner}</tool_call>`;

describe('parseHermesOutput — simple text', () => {
  it('returns the text as-is when there is nothing special', () => {
    const out = parseHermesOutput('Bonjour Paul.');
    expect(out.text).toBe('Bonjour Paul.');
    expect(out.calls).toEqual([]);
    expect(out.thinking).toBe('');
    expect(out.malformed).toBe(0);
  });

  it('truncates at <|im_end|>', () => {
    const out = parseHermesOutput('Réponse<|im_end|>déchet suivant');
    expect(out.text).toBe('Réponse');
  });

  it('trims the edge whitespace of the visible text', () => {
    expect(parseHermesOutput('  Salut  \n').text).toBe('Salut');
  });
});

describe('parseHermesOutput — think blocks', () => {
  it('extracts the reasoning and removes it from the text', () => {
    const out = parseHermesOutput('<think>je réfléchis</think>Voici la réponse.');
    expect(out.thinking).toBe('je réfléchis');
    expect(out.text).toBe('Voici la réponse.');
  });

  it('concatenates several think blocks', () => {
    const out = parseHermesOutput('<think>un</think>A<think>deux</think>B');
    expect(out.thinking).toBe('un\ndeux');
    expect(out.text).toBe('AB');
  });

  it('handles a multi-line think', () => {
    const out = parseHermesOutput('<think>ligne1\nligne2</think>ok');
    expect(out.thinking).toBe('ligne1\nligne2');
    expect(out.text).toBe('ok');
  });

  it('ignores a never-closed think (no phantom text)', () => {
    const out = parseHermesOutput('<think>coupé au milieu');
    expect(out.text).toBe('');
    expect(out.thinking).toBe('coupé au milieu');
  });
});

describe('parseHermesOutput — tool calls', () => {
  it('extracts a simple call and removes it from the text', () => {
    const out = parseHermesOutput(
      `Je regarde.${call('{"name": "read_file", "arguments": {"path": "src/a.ts"}}')}`,
    );
    expect(out.text).toBe('Je regarde.');
    expect(out.calls).toEqual([
      { name: 'read_file', arguments: { path: 'src/a.ts' } },
    ]);
  });

  it('extracts several parallel calls in order', () => {
    const out = parseHermesOutput(
      call('{"name": "a", "arguments": {}}') +
        '\n' +
        call('{"name": "b", "arguments": {"x": 1}}'),
    );
    expect(out.calls.map((c) => c.name)).toEqual(['a', 'b']);
    expect(out.calls[1]!.arguments).toEqual({ x: 1 });
  });

  it('preserves the JSON types of the arguments', () => {
    const out = parseHermesOutput(
      call(
        '{"name": "t", "arguments": {"s": "x", "n": 3.5, "b": true, "z": null, "arr": [1, "deux"], "obj": {"k": "v"}}}',
      ),
    );
    expect(out.calls[0]!.arguments).toEqual({
      s: 'x',
      n: 3.5,
      b: true,
      z: null,
      arr: [1, 'deux'],
      obj: { k: 'v' },
    });
  });

  it('accepts spaces and newlines around the JSON', () => {
    const out = parseHermesOutput(
      '<tool_call>\n  {"name": "t", "arguments": {}}\n</tool_call>',
    );
    expect(out.calls[0]).toEqual({ name: 't', arguments: {} });
  });

  it('tolerates a missing arguments field (parameter-less tool)', () => {
    const out = parseHermesOutput(call('{"name": "list"}'));
    expect(out.calls[0]).toEqual({ name: 'list', arguments: {} });
  });

  it('accepts arguments serialized as a JSON string (frequent variant)', () => {
    const out = parseHermesOutput(
      call('{"name": "t", "arguments": "{\\"path\\": \\"a.ts\\"}"}'),
    );
    expect(out.calls[0]!.arguments).toEqual({ path: 'a.ts' });
  });

  it('supports text between two calls', () => {
    const out = parseHermesOutput(
      `avant${call('{"name": "a", "arguments": {}}')}milieu${call('{"name": "b", "arguments": {}}')}après`,
    );
    expect(out.text).toBe('avantmilieuaprès');
    expect(out.calls).toHaveLength(2);
  });

  it('combines think and tool_call', () => {
    const out = parseHermesOutput(
      `<think>il faut lire</think>ok${call('{"name": "read_file", "arguments": {"path": "a"}}')}`,
    );
    expect(out.thinking).toBe('il faut lire');
    expect(out.text).toBe('ok');
    expect(out.calls[0]!.name).toBe('read_file');
  });
});

describe('parseHermesOutput — robustness', () => {
  it('counts an invalid JSON without throwing', () => {
    const out = parseHermesOutput(call('{ceci n’est pas du json}'));
    expect(out.calls).toEqual([]);
    expect(out.malformed).toBe(1);
  });

  it('counts a call with no usable name', () => {
    const out = parseHermesOutput(call('{"arguments": {"x": 1}}'));
    expect(out.calls).toEqual([]);
    expect(out.malformed).toBe(1);
  });

  it('ignores a never-closed tool_call block', () => {
    const out = parseHermesOutput('texte<tool_call>{"name": "a"');
    expect(out.text).toBe('texte');
    expect(out.calls).toEqual([]);
    expect(out.malformed).toBe(1);
  });

  it('keeps the valid calls even if another one is broken', () => {
    const out = parseHermesOutput(
      call('{"name": "bon", "arguments": {}}') + call('{cassé}'),
    );
    expect(out.calls.map((c) => c.name)).toEqual(['bon']);
    expect(out.malformed).toBe(1);
  });

  it('does not break on an argument containing angle brackets', () => {
    const out = parseHermesOutput(
      call('{"name": "write", "arguments": {"content": "a < b && c > d"}}'),
    );
    expect(out.calls[0]!.arguments).toEqual({ content: 'a < b && c > d' });
  });

  it('extracts nothing after <|im_end|> (out-of-perimeter call ignored)', () => {
    const out = parseHermesOutput(
      `Fini<|im_end|>${call('{"name": "fantome", "arguments": {}}')}`,
    );
    expect(out.text).toBe('Fini');
    expect(out.calls).toEqual([]);
  });

  it('accepts an empty string', () => {
    expect(parseHermesOutput('')).toEqual({
      text: '',
      thinking: '',
      calls: [],
      malformed: 0,
    });
  });
});
