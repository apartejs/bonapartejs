/**
 * A conversation that changes model is rendered again by the new family
 * (task 7.4): the system prompt frozen again with the truth of the moment
 * (the head), then every turn of the person, every answer (its text and its
 * calls, read back from what the old model wrote; no reasoning), every tool
 * result and every note of a going back — the notes of state are folded into
 * the head. After a compaction, the summary and what came after it.
 */

import { describe, expect, it } from 'vitest';
import { familyLayer } from '../families/index.js';
import type { JournalBody, JournalEntry } from '../journal/types.js';
import { summaryNote } from './compact.js';
import { branchModel, rerenderConversation } from './switch.js';

const gemma = familyLayer('gemma');
const qwen = familyLayer('qwen');
const Q = '<|"|>';

let next = 0;
const entry = (body: JournalBody & { rendered?: string }): JournalEntry => ({ id: `e${(next += 1)}`, at: new Date(next * 1000).toISOString(), ...body }) as JournalEntry;

/** A Gemma conversation, as the engine froze it. */
function gemmaConversation(): JournalEntry[] {
  return [
    entry({ kind: 'system', rendered: gemma.renderSystem('OLD SYSTEM'), modelId: 'gemma.gguf', family: 'gemma' }),
    entry({ kind: 'system', rendered: gemma.renderSystemNote('OLD PROJECT') }),
    entry({ kind: 'delta', delta: { kind: 'mode', text: 'You are now in Plume.', mode: 'plume' }, rendered: gemma.renderSystemNote('You are now in Plume.') }),
    entry({ kind: 'user', text: 'Lis a.ts', rendered: gemma.renderUser('Lis a.ts') }),
    entry({
      kind: 'assistant',
      raw: `<|channel>thought\nJe dois lire.<channel|>Je lis.<|tool_call>call:read_file{path:${Q}a.ts${Q}}<tool_call|>`,
      rendered: 'GEMMA-ANSWER-1',
    }),
    entry({ kind: 'tool-results', results: [{ toolCallId: 'c1', name: 'read_file', content: 'export {}' }], rendered: 'GEMMA-RESULTS' }),
    entry({ kind: 'assistant', raw: 'Le fichier est vide.', rendered: 'GEMMA-ANSWER-2' }),
    entry({ kind: 'delta', delta: { kind: 'note', text: 'The files went back.' }, rendered: gemma.renderSystemNote('The files went back.') }),
    entry({ kind: 'user', text: 'Merci', rendered: gemma.renderUser('Merci') }),
    entry({ kind: 'assistant', raw: 'De rien.', rendered: 'GEMMA-ANSWER-3' }),
  ];
}

describe('a conversation rendered again by another family', () => {
  it('from Gemma to Qwen: the head, the turns, the answers with their calls, the results, the notes of a going back', () => {
    const head = qwen.renderSystem('NEW SYSTEM') + qwen.renderSystemNote('NEW PROJECT');
    const rendered = rerenderConversation(gemmaConversation(), { from: gemma, to: qwen, head });
    expect(rendered).toBe(
      head +
        qwen.renderUser('Lis a.ts') +
        qwen.renderAnswer({ text: 'Je lis.', calls: [{ name: 'read_file', input: { path: 'a.ts' } }] }) +
        qwen.renderToolResults([{ toolCallId: 'c1', name: 'read_file', content: 'export {}' }]) +
        qwen.renderAnswer({ text: 'Le fichier est vide.', calls: [], continuing: true }) +
        qwen.renderSystemNote('The files went back.') +
        qwen.renderUser('Merci') +
        qwen.renderAnswer({ text: 'De rien.', calls: [] }),
    );
    // Nothing of the old family's text, nor of its reasoning; the notes of state are in the head now.
    expect(rendered).not.toContain('<|turn>');
    expect(rendered).not.toContain('Je dois lire.');
    expect(rendered).not.toContain('Plume');
    expect(rendered).not.toContain('OLD');
  });

  it('back to Gemma: an answer after its results goes on in the same turn of the model', () => {
    const head = gemma.renderSystem('S');
    const rendered = rerenderConversation(gemmaConversation(), { from: gemma, to: gemma, head });
    expect(rendered).toContain(
      gemma.renderAnswer({ text: 'Je lis.', calls: [{ name: 'read_file', input: { path: 'a.ts' } }] }) +
        gemma.renderToolResults([{ toolCallId: 'c1', name: 'read_file', content: 'export {}' }]) +
        'Le fichier est vide.<turn|>\n',
    );
  });

  it('a call nobody answered is not rendered: its turn is closed', () => {
    const entries = [
      entry({ kind: 'system', rendered: gemma.renderSystem('S') }),
      entry({ kind: 'user', text: 'Lis', rendered: '' }),
      entry({ kind: 'assistant', raw: `Je lis.<|tool_call>call:read_file{path:${Q}a.ts${Q}}<tool_call|>`, stopped: 'user', rendered: '' }),
      entry({ kind: 'user', text: 'Laisse', rendered: '' }),
    ];
    const rendered = rerenderConversation(entries, { from: gemma, to: qwen, head: '' });
    expect(rendered).toBe(qwen.renderUser('Lis') + qwen.renderAnswer({ text: 'Je lis.', calls: [] }) + qwen.renderUser('Laisse'));
  });

  it('a call answered after a pause: the pause and its answers are not text, the results are', () => {
    const entries = [
      entry({ kind: 'system', rendered: gemma.renderSystem('S') }),
      entry({ kind: 'user', text: 'Écris', rendered: '' }),
      entry({ kind: 'assistant', raw: `<|tool_call>call:write_file{path:${Q}a${Q}}<tool_call|>`, rendered: '' }),
      entry({ kind: 'pending', calls: [], ticket: 't', rendered: '' }),
      entry({ kind: 'outcomes', outcomes: {}, rendered: '' }),
      entry({ kind: 'tool-results', results: [{ toolCallId: 'c1', name: 'write_file', content: 'Written.' }], rendered: '' }),
      entry({ kind: 'assistant', raw: 'Écrit.', rendered: '' }),
    ];
    expect(rerenderConversation(entries, { from: gemma, to: qwen, head: '' })).toBe(
      qwen.renderUser('Écris') +
        qwen.renderAnswer({ text: '', calls: [{ name: 'write_file', input: { path: 'a' } }] }) +
        qwen.renderToolResults([{ toolCallId: 'c1', name: 'write_file', content: 'Written.' }]) +
        qwen.renderAnswer({ text: 'Écrit.', calls: [] }),
    );
  });

  it('an answer that waits on its calls keeps them open: their results come with the resume', () => {
    const entries = [
      entry({ kind: 'system', rendered: gemma.renderSystem('S') }),
      entry({ kind: 'user', text: 'Écris', rendered: '' }),
      entry({ kind: 'assistant', raw: `<|tool_call>call:write_file{path:${Q}a${Q}}<tool_call|>`, rendered: '' }),
      entry({ kind: 'pending', calls: [], ticket: 't', rendered: '' }),
    ];
    expect(rerenderConversation(entries, { from: gemma, to: gemma, head: '' })).toBe(
      gemma.renderUser('Écris') + gemma.renderAnswer({ text: '', calls: [{ name: 'write_file', input: { path: 'a' } }] }),
    );
  });

  it('after a compaction: the summary, the turns it kept, and what came after', () => {
    const before = gemmaConversation();
    const kept = before.findIndex((item) => item.kind === 'user' && item.text === 'Merci');
    const entries = [
      ...before,
      entry({ kind: 'rebase', summary: 'RÉSUMÉ', keptFrom: before[kept]!.id, stable: gemma.renderSystem('S2'), rendered: 'GEMMA-REBASE' }),
      entry({ kind: 'user', text: 'Et après ?', rendered: '' }),
    ];
    expect(rerenderConversation(entries, { from: gemma, to: qwen, head: 'HEAD' })).toBe(
      'HEAD' +
        qwen.renderSystemNote(summaryNote('RÉSUMÉ')) +
        qwen.renderUser('Merci') +
        qwen.renderAnswer({ text: 'De rien.', calls: [] }) +
        qwen.renderUser('Et après ?'),
    );
  });

  it('a change of model before: its own text is not read again, the turns under it are', () => {
    const before = gemmaConversation();
    const entries = [
      ...before,
      entry({ kind: 'engine', engineId: 'builtin', modelId: 'qwen.gguf', family: 'qwen', rendered: 'QWEN-HEAD-AND-HISTORY' }),
      entry({ kind: 'user', text: 'Encore', rendered: qwen.renderUser('Encore') }),
      entry({ kind: 'assistant', raw: '<think>\nhm\n</think>\n\nOui.', rendered: '' }),
    ];
    const rendered = rerenderConversation(entries, { from: qwen, to: gemma, head: 'HEAD' });
    expect(rendered).not.toContain('QWEN-HEAD-AND-HISTORY');
    expect(rendered).toContain(gemma.renderUser('Lis a.ts'));
    // Each answer read back by the family that wrote it.
    expect(rendered.endsWith(gemma.renderUser('Encore') + gemma.renderAnswer({ text: 'Oui.', calls: [] }))).toBe(true);
  });
});

describe('the model a branch runs on', () => {
  it('is its first system turn, then the last change of model', () => {
    const entries = gemmaConversation();
    expect(branchModel(entries)).toEqual({ modelId: 'gemma.gguf', family: 'gemma' });
    entries.push(entry({ kind: 'engine', engineId: 'builtin', modelId: 'qwen.gguf', family: 'qwen' }));
    expect(branchModel(entries)).toEqual({ modelId: 'qwen.gguf', family: 'qwen' });
  });

  it('a journal from before the record: its family read in its prompt, no model', () => {
    expect(branchModel([entry({ kind: 'system', rendered: gemma.renderSystem('S') })])).toEqual({ family: 'gemma' });
    expect(branchModel([entry({ kind: 'system', rendered: qwen.renderSystem('S') })])).toEqual({ family: 'qwen' });
    expect(branchModel([])).toEqual({});
  });
});
