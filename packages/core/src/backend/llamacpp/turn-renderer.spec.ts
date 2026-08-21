import { describe, expect, it } from 'vitest';
import type { SystemSpec, ToolDefLike, TranscriptEntry } from '../types.js';
import { TranscriptRenderer } from './turn-renderer.js';

const SYSTEM: SystemSpec = { roots: ['C:\\projet'] };
const TOOLS: ToolDefLike[] = [
  { name: 'read_file', description: 'lit', inputSchema: { type: 'object' } },
];

/** Déroule une conversation et rend les prompts successifs. */
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
  it('chaque prompt étend octet-pour-octet le précédent', () => {
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

  it('rejeu depuis zéro : le prompt est OCTET-IDENTIQUE à la session vivante', () => {
    // C'est LA condition du restore de cache KV entre deux ouvertures.
    const live = new TranscriptRenderer();
    const { prompts, transcript } = play(live, [
      { user: 'Q1', raw: '<think>hm</think>R1' },
      { user: 'Q2', raw: 'R2' },
    ]);

    const replayed = new TranscriptRenderer();
    replayed.restore(live.systemPrompt as string);
    transcript.push({ role: 'user', text: 'Q3' });
    const afterReplay = replayed.next(transcript, SYSTEM, TOOLS).prompt;

    // Le rendu rejoué doit étendre exactement le dernier prompt vivant.
    const lastLive = prompts.at(-1) as string;
    expect(afterReplay.startsWith(lastLive)).toBe(true);
  });

  it('rend les résultats d’outils comme un tour utilisateur', () => {
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

  it('n’expose aucun prompt système tant qu’aucun tour n’a été rendu', () => {
    expect(new TranscriptRenderer().systemPrompt).toBeNull();
  });

  it('le prompt système figé est réutilisé tel quel après restore', () => {
    const renderer = new TranscriptRenderer();
    renderer.restore('SYSTÈME GELÉ');
    const prompt = renderer.next([{ role: 'user', text: 'x' }], SYSTEM, TOOLS).prompt;
    expect(prompt.startsWith('<|im_start|>system\nSYSTÈME GELÉ<|im_end|>\n')).toBe(true);
  });

  it('un inventaire d’outils différent ne change pas un prompt déjà figé', () => {
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
      { name: 'run_shell', description: 'exécute', inputSchema: { type: 'object' } },
    ]);
    expect(renderer.systemPrompt).toBe(frozen);
  });
});
