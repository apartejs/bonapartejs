import { describe, expect, it } from 'vitest';
import { PromptLog, renderSystem, renderUser } from './qwen-template.js';

describe('basic ChatML renders', () => {
  it('renderSystem produces the exact block', () => {
    expect(renderSystem('Tu es bonaparte.')).toBe(
      '<|im_start|>system\nTu es bonaparte.<|im_end|>\n',
    );
  });

  it('renderUser produces the exact block', () => {
    expect(renderUser('Salut !')).toBe('<|im_start|>user\nSalut !<|im_end|>\n');
  });
});

describe('PromptLog — append-only, byte-identical', () => {
  it('first turn (thinking active): exact prompt', () => {
    const log = new PromptLog('SYS');
    log.appendUser('Bonjour');
    const prompt = log.beginAssistantTurn({ thinking: true });
    expect(prompt).toBe(
      '<|im_start|>system\nSYS<|im_end|>\n' +
        '<|im_start|>user\nBonjour<|im_end|>\n' +
        '<|im_start|>assistant\n',
    );
  });

  it('thinking disabled: the suffix forces an empty think block', () => {
    const log = new PromptLog('SYS');
    log.appendUser('Bonjour');
    const prompt = log.beginAssistantTurn({ thinking: false });
    expect(prompt.endsWith('<|im_start|>assistant\n<think>\n\n</think>\n\n')).toBe(
      true,
    );
  });

  it('no application-level BOS: the prompt starts with <|im_start|>system', () => {
    const log = new PromptLog('SYS');
    log.appendUser('x');
    expect(log.beginAssistantTurn({ thinking: true }).startsWith('<|im_start|>system')).toBe(true);
  });

  it('the next turn’s prompt extends the previous one byte-for-byte + generation', () => {
    const log = new PromptLog('SYS');
    log.appendUser('Question 1');
    const p1 = log.beginAssistantTurn({ thinking: true });
    const raw = '<think>je réfléchis</think>Réponse 1';
    log.completeAssistantTurn(raw);
    log.appendUser('Question 2');
    const p2 = log.beginAssistantTurn({ thinking: true });

    expect(p2.startsWith(p1)).toBe(true);
    expect(p2.startsWith(p1 + raw + '<|im_end|>\n')).toBe(true);
  });

  it('generated <think> blocks stay verbatim in the frozen history', () => {
    const log = new PromptLog('SYS');
    log.appendUser('Q');
    log.beginAssistantTurn({ thinking: true });
    log.completeAssistantTurn('<think>raisonnement secret</think>Réponse');
    expect(log.frozen).toContain('<think>raisonnement secret</think>Réponse');
  });

  it('toggling thinking between turns preserves the prefix property', () => {
    const log = new PromptLog('SYS');
    log.appendUser('Q1');
    const p1 = log.beginAssistantTurn({ thinking: false });
    log.completeAssistantTurn('R1');
    log.appendUser('Q2');
    const p2 = log.beginAssistantTurn({ thinking: true });
    expect(p2.startsWith(p1 + 'R1' + '<|im_end|>\n')).toBe(true);
  });

  it('PROPERTY: over 30 pseudo-random turns, each prompt is a strict prefix of the next', () => {
    // Deterministic LCG — no Math.random, so the test is replayable.
    let seed = 42;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const randText = (): string => {
      const len = 1 + Math.floor(rand() * 40);
      let out = '';
      for (let i = 0; i < len; i++) {
        out += String.fromCharCode(32 + Math.floor(rand() * 500));
      }
      return out;
    };

    const log = new PromptLog(randText());
    let previous: string | null = null;
    for (let turn = 0; turn < 30; turn++) {
      log.appendUser(randText());
      const prompt = log.beginAssistantTurn({ thinking: rand() > 0.5 });
      if (previous !== null) {
        expect(prompt.startsWith(previous)).toBe(true);
        expect(prompt.length).toBeGreaterThan(previous.length);
      }
      previous = prompt;
      const raw = (rand() > 0.5 ? `<think>${randText()}</think>` : '') + randText();
      log.completeAssistantTurn(raw);
    }
  });

  it('protects the invariant: beginAssistantTurn twice without complete ⇒ error', () => {
    const log = new PromptLog('SYS');
    log.appendUser('Q');
    log.beginAssistantTurn({ thinking: true });
    expect(() => log.beginAssistantTurn({ thinking: true })).toThrow(/turn/);
  });

  it('protects the invariant: complete without begin ⇒ error', () => {
    const log = new PromptLog('SYS');
    expect(() => log.completeAssistantTurn('R')).toThrow(/turn/);
  });

  it('protects the invariant: appendUser during an open assistant turn ⇒ error', () => {
    const log = new PromptLog('SYS');
    log.appendUser('Q');
    log.beginAssistantTurn({ thinking: true });
    expect(() => log.appendUser('Q2')).toThrow(/turn/);
  });
});
