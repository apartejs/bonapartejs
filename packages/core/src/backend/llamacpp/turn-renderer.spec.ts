import { describe, expect, it } from 'vitest';
import type { SystemSpec, ToolDefLike, TranscriptEntry } from '../types.js';
import { TranscriptRenderer } from './turn-renderer.js';

const SYSTEM: SystemSpec = { roots: ['C:\\projet'] };
const TOOLS: ToolDefLike[] = [
  { name: 'read_file', description: 'reads', inputSchema: { type: 'object' } },
];

/** Runs through a conversation and renders the successive prompts. */
function play(
  renderer: TranscriptRenderer,
  script: { user: string; raw: string }[],
): { prompts: string[]; transcript: TranscriptEntry[] } {
  const transcript: TranscriptEntry[] = [];
  const prompts: string[] = [];
  for (const turn of script) {
    transcript.push({ role: 'user', text: turn.user });
    const rendered = renderer.next(transcript, SYSTEM, TOOLS);
    prompts.push(rendered.prompt);
    rendered.commit(turn.raw);
    transcript.push({ role: 'assistant', text: turn.raw, raw: turn.raw });
  }
  return { prompts, transcript };
}

describe('TranscriptRenderer — append-only', () => {
  it('each prompt extends the previous one byte-for-byte', () => {
    const { prompts } = play(new TranscriptRenderer(), [
      { user: 'Q1', raw: 'R1' },
      { user: 'Q2', raw: 'R2' },
      { user: 'Q3', raw: 'R3' },
    ]);
    for (let i = 1; i < prompts.length; i++) {
      expect(prompts[i]!.startsWith(prompts[i - 1]!)).toBe(true);
      expect(prompts[i]!.length).toBeGreaterThan(prompts[i - 1]!.length);
    }
  });

  it('replay from scratch: the prompt is BYTE-IDENTICAL to the live session', () => {
    // This is THE condition for KV cache restore across two openings.
    const live = new TranscriptRenderer();
    const { prompts, transcript } = play(live, [
      { user: 'Q1', raw: '<think>hm</think>R1' },
      { user: 'Q2', raw: 'R2' },
    ]);

    const replayed = new TranscriptRenderer();
    replayed.restore(live.systemPrompt as string);
    transcript.push({ role: 'user', text: 'Q3' });
    const afterReplay = replayed.next(transcript, SYSTEM, TOOLS).prompt;

    // The replayed render must extend exactly the last live prompt.
    const lastLive = prompts.at(-1) as string;
    expect(afterReplay.startsWith(lastLive)).toBe(true);
  });

  it('replay keeps the reasoning suffix of the live turn even when the model did not think', () => {
    // Reasoning ON renders a bare assistant header; the model may still
    // answer without a <think> block. On replay, deriving the suffix from
    // the presence of thinking content would insert an empty think block
    // the live turn never had — and the prefix would break right there.
    const live = new TranscriptRenderer();
    const transcript: TranscriptEntry[] = [{ role: 'user', text: 'Q1' }];
    const first = live.next(transcript, SYSTEM, TOOLS, { thinking: true });
    first.commit('R1');
    transcript.push({ role: 'assistant', text: 'R1', raw: 'R1', reasoning: true });
    transcript.push({ role: 'user', text: 'Q2' });
    const lastLive = live.next(transcript, SYSTEM, TOOLS, { thinking: true }).prompt;

    const replayed = new TranscriptRenderer();
    replayed.restore(live.systemPrompt as string);
    const afterReplay = replayed.next(transcript, SYSTEM, TOOLS, { thinking: true }).prompt;

    expect(afterReplay).toBe(lastLive);
  });

  it('renders tool results as a user turn', () => {
    const renderer = new TranscriptRenderer();
    const transcript: TranscriptEntry[] = [
      { role: 'user', text: 'lis' },
      { role: 'assistant', text: '', raw: '', calls: [{ name: 'read_file', arguments: {} }] },
      {
        role: 'tool_results',
        results: [{ name: 'read_file', ok: true, content: 'const a = 1;' }],
      },
    ];
    const prompt = renderer.next(transcript, SYSTEM, TOOLS).prompt;
    expect(prompt).toContain('const a = 1;');
    expect(prompt).toContain('tool result: read_file');
  });

  it('exposes no system prompt until a turn has been rendered', () => {
    expect(new TranscriptRenderer().systemPrompt).toBeNull();
  });

  it('the frozen system prompt is reused as-is after restore', () => {
    const renderer = new TranscriptRenderer();
    renderer.restore('FROZEN SYSTEM');
    const prompt = renderer.next([{ role: 'user', text: 'x' }], SYSTEM, TOOLS).prompt;
    expect(prompt.startsWith('<|im_start|>system\nFROZEN SYSTEM<|im_end|>\n')).toBe(true);
  });

  it('a different tool inventory does not change an already-frozen prompt', () => {
    const renderer = new TranscriptRenderer();
    const first = renderer.next([{ role: 'user', text: 'x' }], SYSTEM, TOOLS);
    first.commit('R');
    const frozen = renderer.systemPrompt;

    const transcript: TranscriptEntry[] = [
      { role: 'user', text: 'x' },
      { role: 'assistant', text: 'R', raw: 'R' },
      { role: 'user', text: 'y' },
    ];
    renderer.next(transcript, SYSTEM, [
      ...TOOLS,
      { name: 'run_shell', description: 'executes', inputSchema: { type: 'object' } },
    ]);
    expect(renderer.systemPrompt).toBe(frozen);
  });
});
