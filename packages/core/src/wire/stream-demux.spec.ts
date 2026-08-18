import { describe, expect, it } from 'vitest';
import { HermesStreamDemux, type DemuxEvent } from './stream-demux.js';

/** Concatène les deltas d'un type donné sur toute une séquence de pushes. */
function run(chunks: string[]): {
  text: string;
  thinking: string;
  raw: string;
  events: DemuxEvent[];
} {
  const demux = new HermesStreamDemux();
  const events: DemuxEvent[] = [];
  for (const chunk of chunks) events.push(...demux.push(chunk));
  events.push(...demux.flush());
  return {
    text: events.filter((e) => e.type === 'text').map((e) => e.delta).join(''),
    thinking: events
      .filter((e) => e.type === 'thinking')
      .map((e) => e.delta)
      .join(''),
    raw: demux.raw,
    events,
  };
}

describe('HermesStreamDemux — texte', () => {
  it('laisse passer du texte simple', () => {
    expect(run(['Bonjour Paul.']).text).toBe('Bonjour Paul.');
  });

  it('émet au fil des chunks (pas de rétention inutile)', () => {
    const demux = new HermesStreamDemux();
    expect(demux.push('Bon')).toEqual([{ type: 'text', delta: 'Bon' }]);
    expect(demux.push('jour')).toEqual([{ type: 'text', delta: 'jour' }]);
  });

  it('accumule la sortie brute verbatim', () => {
    const chunks = ['a<think>b</think>', 'c<tool_call>{}</tool_call>d'];
    expect(run(chunks).raw).toBe(chunks.join(''));
  });
});

describe('HermesStreamDemux — think', () => {
  it('masque le raisonnement du texte et l’émet à part', () => {
    const out = run(['<think>je réfléchis</think>Réponse']);
    expect(out.text).toBe('Réponse');
    expect(out.thinking).toBe('je réfléchis');
  });

  it('gère un think réparti sur plusieurs chunks', () => {
    const out = run(['<think>je ', 'réflé', 'chis</think>', 'Réponse']);
    expect(out.thinking).toBe('je réfléchis');
    expect(out.text).toBe('Réponse');
  });

  it('gère plusieurs blocs think', () => {
    const out = run(['<think>a</think>X<think>b</think>Y']);
    expect(out.thinking).toBe('ab');
    expect(out.text).toBe('XY');
  });
});

describe('HermesStreamDemux — tool_call', () => {
  it('masque entièrement un appel d’outil', () => {
    const out = run([
      'Je regarde.<tool_call>{"name": "read_file", "arguments": {}}</tool_call>',
    ]);
    expect(out.text).toBe('Je regarde.');
    expect(out.thinking).toBe('');
  });

  it('masque un appel réparti sur plusieurs chunks', () => {
    const out = run(['ok<tool_call>{"na', 'me": "a", "argum', 'ents": {}}</tool_call>']);
    expect(out.text).toBe('ok');
  });

  it('ne laisse rien fuiter d’un appel jamais refermé', () => {
    const out = run(['ok<tool_call>{"name": "a"']);
    expect(out.text).toBe('ok');
  });
});

describe('HermesStreamDemux — balises coupées entre chunks', () => {
  it('ne laisse pas fuiter un début de balise tool_call', () => {
    const out = run(['Bonjour <to', 'ol_call>{"name":"a","arguments":{}}</tool_call>']);
    expect(out.text).toBe('Bonjour ');
  });

  it('ne laisse pas fuiter un début de balise think', () => {
    const out = run(['Salut <thi', 'nk>caché</think>fin']);
    expect(out.text).toBe('Salut fin');
    expect(out.thinking).toBe('caché');
  });

  it('restitue un chevron isolé qui n’était pas une balise', () => {
    expect(run(['a < b']).text).toBe('a < b');
  });

  it('restitue un faux départ de balise', () => {
    expect(run(['x <thin', 'g> y']).text).toBe('x <thing> y');
  });

  it('flush restitue une retenue de fin de génération', () => {
    const demux = new HermesStreamDemux();
    demux.push('fin <');
    expect(demux.flush()).toEqual([{ type: 'text', delta: '<' }]);
  });

  it('ne laisse pas fuiter une balise fermante think coupée', () => {
    const out = run(['<think>abc</thi', 'nk>visible']);
    expect(out.thinking).toBe('abc');
    expect(out.text).toBe('visible');
  });
});

describe('HermesStreamDemux — fin de tour', () => {
  it('cesse d’émettre après <|im_end|>', () => {
    const out = run(['Fini<|im_end|>déchet']);
    expect(out.text).toBe('Fini');
  });

  it('détecte <|im_end|> coupé entre deux chunks', () => {
    const out = run(['Fini<|im_', 'end|>déchet']);
    expect(out.text).toBe('Fini');
  });
});
