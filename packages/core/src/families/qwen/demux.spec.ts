import { describe, expect, it } from 'vitest';
import { HermesStreamDemux, type DemuxEvent } from './demux.js';

/** Concatenates the deltas of a given type over a whole sequence of pushes. */
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

describe('HermesStreamDemux — text', () => {
  it('lets simple text pass through', () => {
    expect(run(['Bonjour Paul.']).text).toBe('Bonjour Paul.');
  });

  it('emits as chunks arrive (no unnecessary retention)', () => {
    const demux = new HermesStreamDemux();
    expect(demux.push('Bon')).toEqual([{ type: 'text', delta: 'Bon' }]);
    expect(demux.push('jour')).toEqual([{ type: 'text', delta: 'jour' }]);
  });

  it('accumulates the raw output verbatim', () => {
    const chunks = ['a<think>b</think>', 'c<tool_call>{}</tool_call>d'];
    expect(run(chunks).raw).toBe(chunks.join(''));
  });
});

describe('HermesStreamDemux — think', () => {
  it('hides the reasoning from the text and emits it separately', () => {
    const out = run(['<think>je réfléchis</think>Réponse']);
    expect(out.text).toBe('Réponse');
    expect(out.thinking).toBe('je réfléchis');
  });

  it('handles a think split across several chunks', () => {
    const out = run(['<think>je ', 'réflé', 'chis</think>', 'Réponse']);
    expect(out.thinking).toBe('je réfléchis');
    expect(out.text).toBe('Réponse');
  });

  it('handles several think blocks', () => {
    const out = run(['<think>a</think>X<think>b</think>Y']);
    expect(out.thinking).toBe('ab');
    expect(out.text).toBe('XY');
  });
});

describe('HermesStreamDemux — tool_call', () => {
  it('fully hides a tool call', () => {
    const out = run([
      'Je regarde.<tool_call>{"name": "read_file", "arguments": {}}</tool_call>',
    ]);
    expect(out.text).toBe('Je regarde.');
    expect(out.thinking).toBe('');
  });

  it('hides a call split across several chunks', () => {
    const out = run(['ok<tool_call>{"na', 'me": "a", "argum', 'ents": {}}</tool_call>']);
    expect(out.text).toBe('ok');
  });

  it('lets nothing leak from a never-closed call', () => {
    const out = run(['ok<tool_call>{"name": "a"']);
    expect(out.text).toBe('ok');
  });

});

describe('HermesStreamDemux — tags cut across chunks', () => {
  it('does not let a tool_call tag start leak', () => {
    const out = run(['Bonjour <to', 'ol_call>{"name":"a","arguments":{}}</tool_call>']);
    expect(out.text).toBe('Bonjour ');
  });

  it('does not let a think tag start leak', () => {
    const out = run(['Salut <thi', 'nk>caché</think>fin']);
    expect(out.text).toBe('Salut fin');
    expect(out.thinking).toBe('caché');
  });

  it('restores an isolated angle bracket that was not a tag', () => {
    expect(run(['a < b']).text).toBe('a < b');
  });

  it('restores a false tag start', () => {
    expect(run(['x <thin', 'g> y']).text).toBe('x <thing> y');
  });

  it('flush restores a hold-back at the end of generation', () => {
    const demux = new HermesStreamDemux();
    demux.push('fin <');
    expect(demux.flush()).toEqual([{ type: 'text', delta: '<' }]);
  });

  it('does not let a cut think closing tag leak', () => {
    const out = run(['<think>abc</thi', 'nk>visible']);
    expect(out.thinking).toBe('abc');
    expect(out.text).toBe('visible');
  });
});

describe('HermesStreamDemux — end of turn', () => {
  it('stops emitting after <|im_end|>', () => {
    const out = run(['Fini<|im_end|>déchet']);
    expect(out.text).toBe('Fini');
  });

  it('detects <|im_end|> cut between two chunks', () => {
    const out = run(['Fini<|im_', 'end|>déchet']);
    expect(out.text).toBe('Fini');
  });
});
