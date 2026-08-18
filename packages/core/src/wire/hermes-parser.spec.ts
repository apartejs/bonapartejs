import { describe, expect, it } from 'vitest';
import { parseHermesOutput } from './hermes-parser.js';

const call = (inner: string): string => `<tool_call>${inner}</tool_call>`;

describe('parseHermesOutput — texte simple', () => {
  it('retourne le texte tel quel quand il n’y a rien de spécial', () => {
    const out = parseHermesOutput('Bonjour Paul.');
    expect(out.text).toBe('Bonjour Paul.');
    expect(out.calls).toEqual([]);
    expect(out.thinking).toBe('');
    expect(out.malformed).toBe(0);
  });

  it('tronque à <|im_end|>', () => {
    const out = parseHermesOutput('Réponse<|im_end|>déchet suivant');
    expect(out.text).toBe('Réponse');
  });

  it('rogne les espaces de bord du texte visible', () => {
    expect(parseHermesOutput('  Salut  \n').text).toBe('Salut');
  });
});

describe('parseHermesOutput — blocs think', () => {
  it('extrait le raisonnement et le retire du texte', () => {
    const out = parseHermesOutput('<think>je réfléchis</think>Voici la réponse.');
    expect(out.thinking).toBe('je réfléchis');
    expect(out.text).toBe('Voici la réponse.');
  });

  it('concatène plusieurs blocs think', () => {
    const out = parseHermesOutput('<think>un</think>A<think>deux</think>B');
    expect(out.thinking).toBe('un\ndeux');
    expect(out.text).toBe('AB');
  });

  it('gère un think multi-lignes', () => {
    const out = parseHermesOutput('<think>ligne1\nligne2</think>ok');
    expect(out.thinking).toBe('ligne1\nligne2');
    expect(out.text).toBe('ok');
  });

  it('ignore un think jamais refermé (pas de texte fantôme)', () => {
    const out = parseHermesOutput('<think>coupé au milieu');
    expect(out.text).toBe('');
    expect(out.thinking).toBe('coupé au milieu');
  });
});

describe('parseHermesOutput — appels d’outils', () => {
  it('extrait un appel simple et le retire du texte', () => {
    const out = parseHermesOutput(
      `Je regarde.${call('{"name": "read_file", "arguments": {"path": "src/a.ts"}}')}`,
    );
    expect(out.text).toBe('Je regarde.');
    expect(out.calls).toEqual([
      { name: 'read_file', arguments: { path: 'src/a.ts' } },
    ]);
  });

  it('extrait plusieurs appels parallèles dans l’ordre', () => {
    const out = parseHermesOutput(
      call('{"name": "a", "arguments": {}}') +
        '\n' +
        call('{"name": "b", "arguments": {"x": 1}}'),
    );
    expect(out.calls.map((c) => c.name)).toEqual(['a', 'b']);
    expect(out.calls[1]!.arguments).toEqual({ x: 1 });
  });

  it('préserve les types JSON des arguments', () => {
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

  it('accepte les espaces et retours à la ligne autour du JSON', () => {
    const out = parseHermesOutput(
      '<tool_call>\n  {"name": "t", "arguments": {}}\n</tool_call>',
    );
    expect(out.calls[0]).toEqual({ name: 't', arguments: {} });
  });

  it('tolère arguments absent (outil sans paramètre)', () => {
    const out = parseHermesOutput(call('{"name": "list"}'));
    expect(out.calls[0]).toEqual({ name: 'list', arguments: {} });
  });

  it('accepte des arguments sérialisés en chaîne JSON (variante fréquente)', () => {
    const out = parseHermesOutput(
      call('{"name": "t", "arguments": "{\\"path\\": \\"a.ts\\"}"}'),
    );
    expect(out.calls[0]!.arguments).toEqual({ path: 'a.ts' });
  });

  it('supporte du texte entre deux appels', () => {
    const out = parseHermesOutput(
      `avant${call('{"name": "a", "arguments": {}}')}milieu${call('{"name": "b", "arguments": {}}')}après`,
    );
    expect(out.text).toBe('avantmilieuaprès');
    expect(out.calls).toHaveLength(2);
  });

  it('combine think et tool_call', () => {
    const out = parseHermesOutput(
      `<think>il faut lire</think>ok${call('{"name": "read_file", "arguments": {"path": "a"}}')}`,
    );
    expect(out.thinking).toBe('il faut lire');
    expect(out.text).toBe('ok');
    expect(out.calls[0]!.name).toBe('read_file');
  });
});

describe('parseHermesOutput — robustesse', () => {
  it('compte un JSON invalide sans lever', () => {
    const out = parseHermesOutput(call('{ceci n’est pas du json}'));
    expect(out.calls).toEqual([]);
    expect(out.malformed).toBe(1);
  });

  it('compte un appel sans nom exploitable', () => {
    const out = parseHermesOutput(call('{"arguments": {"x": 1}}'));
    expect(out.calls).toEqual([]);
    expect(out.malformed).toBe(1);
  });

  it('ignore un bloc tool_call jamais refermé', () => {
    const out = parseHermesOutput('texte<tool_call>{"name": "a"');
    expect(out.text).toBe('texte');
    expect(out.calls).toEqual([]);
    expect(out.malformed).toBe(1);
  });

  it('garde les appels valides même si un autre est cassé', () => {
    const out = parseHermesOutput(
      call('{"name": "bon", "arguments": {}}') + call('{cassé}'),
    );
    expect(out.calls.map((c) => c.name)).toEqual(['bon']);
    expect(out.malformed).toBe(1);
  });

  it('ne casse pas sur un argument contenant des chevrons', () => {
    const out = parseHermesOutput(
      call('{"name": "write", "arguments": {"content": "a < b && c > d"}}'),
    );
    expect(out.calls[0]!.arguments).toEqual({ content: 'a < b && c > d' });
  });

  it('n’extrait rien après <|im_end|> (appel hors périmètre ignoré)', () => {
    const out = parseHermesOutput(
      `Fini<|im_end|>${call('{"name": "fantome", "arguments": {}}')}`,
    );
    expect(out.text).toBe('Fini');
    expect(out.calls).toEqual([]);
  });

  it('accepte une chaîne vide', () => {
    expect(parseHermesOutput('')).toEqual({
      text: '',
      thinking: '',
      calls: [],
      malformed: 0,
    });
  });
});
