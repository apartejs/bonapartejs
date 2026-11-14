/**
 * The prompt of a conversation is append-only: what was frozen is never
 * rendered again, so the prompt of turn N+1 extends turn N's byte for byte,
 * and the KV cache of the slot serves the whole prefix. The family layer
 * says how each piece is written.
 */

import { describe, expect, it } from 'vitest';
import { familyLayer } from '../families/index.js';
import { PromptLog } from './prompt-log.js';

const qwen = familyLayer('qwen');

function started(system = 'SYS'): PromptLog {
  const log = new PromptLog(qwen);
  log.appendSystem(system);
  return log;
}

describe('PromptLog — append-only, byte-identical', () => {
  it('first turn (thinking active): exact prompt', () => {
    const log = started();
    log.appendUser('Bonjour');
    expect(log.beginAssistantTurn({ thinking: true })).toBe(
      '<|im_start|>system\nSYS<|im_end|>\n' + '<|im_start|>user\nBonjour<|im_end|>\n' + '<|im_start|>assistant\n',
    );
  });

  it('a conversation of two turns is, byte for byte, the prompt v0 sent', () => {
    const log = started();
    log.appendUser('Question 1');
    log.beginAssistantTurn({ thinking: true });
    log.completeAssistantTurn('<think>je réfléchis</think>Réponse 1');
    log.appendUser('Question 2');
    expect(log.beginAssistantTurn({ thinking: false })).toBe(
      '<|im_start|>system\nSYS<|im_end|>\n' +
        '<|im_start|>user\nQuestion 1<|im_end|>\n' +
        '<|im_start|>assistant\n<think>je réfléchis</think>Réponse 1<|im_end|>\n' +
        '<|im_start|>user\nQuestion 2<|im_end|>\n' +
        '<|im_start|>assistant\n<think>\n\n</think>\n\n',
    );
  });

  it('thinking disabled: the suffix forces an empty think block', () => {
    const log = started();
    log.appendUser('Bonjour');
    expect(log.beginAssistantTurn({ thinking: false }).endsWith('<|im_start|>assistant\n<think>\n\n</think>\n\n')).toBe(
      true,
    );
  });

  it('no application-level BOS: the prompt starts with <|im_start|>system', () => {
    const log = started();
    log.appendUser('x');
    expect(log.beginAssistantTurn({ thinking: true }).startsWith('<|im_start|>system')).toBe(true);
  });

  it("the next turn's prompt extends the previous one byte-for-byte + generation", () => {
    const log = started();
    log.appendUser('Question 1');
    const p1 = log.beginAssistantTurn({ thinking: true });
    const raw = '<think>je réfléchis</think>Réponse 1';
    log.completeAssistantTurn(raw);
    log.appendUser('Question 2');
    const p2 = log.beginAssistantTurn({ thinking: true });
    expect(p2.startsWith(p1 + raw + '<|im_end|>\n')).toBe(true);
  });

  it('generated <think> blocks stay verbatim in the frozen history', () => {
    const log = started();
    log.appendUser('Q');
    log.beginAssistantTurn({ thinking: true });
    log.completeAssistantTurn('<think>raisonnement secret</think>Réponse');
    expect(log.frozen).toContain('<think>raisonnement secret</think>Réponse');
  });

  it('toggling thinking between turns preserves the prefix property', () => {
    const log = started();
    log.appendUser('Q1');
    const p1 = log.beginAssistantTurn({ thinking: false });
    log.completeAssistantTurn('R1');
    log.appendUser('Q2');
    const p2 = log.beginAssistantTurn({ thinking: true });
    expect(p2.startsWith(p1 + 'R1' + '<|im_end|>\n')).toBe(true);
  });

  it('PROPERTY: over 30 pseudo-random turns, each prompt is a strict prefix of the next', () => {
    let seed = 42;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const randText = (): string => {
      const len = 1 + Math.floor(rand() * 40);
      let out = '';
      for (let i = 0; i < len; i++) out += String.fromCharCode(32 + Math.floor(rand() * 500));
      return out;
    };

    const log = started(randText());
    let previous: string | null = null;
    for (let turn = 0; turn < 30; turn++) {
      if (rand() > 0.7) log.appendToolResults([{ toolCallId: `c${turn}`, name: 'read_file', content: randText() }]);
      else log.appendUser(randText());
      const prompt = log.beginAssistantTurn({ thinking: rand() > 0.5 });
      if (previous !== null) {
        expect(prompt.startsWith(previous)).toBe(true);
        expect(prompt.length).toBeGreaterThan(previous.length);
      }
      previous = prompt;
      log.completeAssistantTurn((rand() > 0.5 ? `<think>${randText()}</think>` : '') + randText());
    }
  });

  it('a log reopened from its frozen text goes on exactly where it stood', () => {
    const log = started();
    log.appendUser('Q1');
    log.beginAssistantTurn({ thinking: true });
    log.completeAssistantTurn('R1');
    const reopened = new PromptLog(qwen, log.frozen);
    reopened.appendUser('Q2');
    log.appendUser('Q2');
    expect(reopened.beginAssistantTurn({ thinking: true })).toBe(log.beginAssistantTurn({ thinking: true }));
  });

  it('tool results are appended as a turn of their own', () => {
    const log = started();
    log.appendUser('Lis a.ts');
    log.beginAssistantTurn({ thinking: true });
    log.completeAssistantTurn('<tool_call>{"name": "read_file", "arguments": {"path": "a.ts"}}</tool_call>');
    const before = log.frozen;
    log.appendToolResults([{ toolCallId: 'c1', name: 'read_file', content: 'export {}' }]);
    expect(log.frozen).toBe(before + qwen.renderToolResults([{ toolCallId: 'c1', name: 'read_file', content: 'export {}' }]));
  });
});

describe('PromptLog — what an open turn may not change', () => {
  it('frozen never changes between beginAssistantTurn and completeAssistantTurn', () => {
    const log = started();
    log.appendUser('Q');
    const before = log.frozen;
    log.beginAssistantTurn({ thinking: true });
    expect(log.frozen).toBe(before);
    expect(() => log.appendUser('Q2')).toThrow(/turn/);
    expect(() => log.appendSystem('S2')).toThrow(/turn/);
    expect(() => log.appendToolResults([])).toThrow(/turn/);
    expect(log.frozen).toBe(before);
  });

  it('abandonAssistantTurn gives frozen back as it was', () => {
    const log = started();
    log.appendUser('Q');
    const before = log.frozen;
    log.beginAssistantTurn({ thinking: true });
    log.abandonAssistantTurn();
    expect(log.frozen).toBe(before);
    // And a new turn can begin.
    expect(log.beginAssistantTurn({ thinking: true })).toBe(before + '<|im_start|>assistant\n');
  });

  it('beginAssistantTurn twice without complete: an error', () => {
    const log = started();
    log.appendUser('Q');
    log.beginAssistantTurn({ thinking: true });
    expect(() => log.beginAssistantTurn({ thinking: true })).toThrow(/turn/);
  });

  it('complete without begin: an error', () => {
    expect(() => started().completeAssistantTurn('R')).toThrow(/turn/);
  });

  it('rewind goes back to a prefix of the history, never to another text', () => {
    const log = started();
    const prefix = log.frozen;
    log.appendUser('Q');
    log.rewind(prefix);
    expect(log.frozen).toBe(prefix);
    expect(() => log.rewind('something else')).toThrow(/prefix/);
  });
});
