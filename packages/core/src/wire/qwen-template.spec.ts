import { describe, expect, it } from 'vitest';
import { PromptLog, renderSystem, renderUser } from './qwen-template.js';

describe('rendus ChatML élémentaires', () => {
  it('renderSystem produit le bloc exact', () => {
    expect(renderSystem('Tu es bonaparte.')).toBe(
      '<|im_start|>system\nTu es bonaparte.<|im_end|>\n',
    );
  });

  it('renderUser produit le bloc exact', () => {
    expect(renderUser('Salut !')).toBe('<|im_start|>user\nSalut !<|im_end|>\n');
  });
});

describe('PromptLog — append-only, octet-identique', () => {
  it('premier tour (thinking actif) : prompt exact', () => {
    const log = new PromptLog('SYS');
    log.appendUser('Bonjour');
    const prompt = log.beginAssistantTurn({ thinking: true });
    expect(prompt).toBe(
      '<|im_start|>system\nSYS<|im_end|>\n' +
        '<|im_start|>user\nBonjour<|im_end|>\n' +
        '<|im_start|>assistant\n',
    );
  });

  it('thinking désactivé : le suffixe force le bloc think vide', () => {
    const log = new PromptLog('SYS');
    log.appendUser('Bonjour');
    const prompt = log.beginAssistantTurn({ thinking: false });
    expect(prompt.endsWith('<|im_start|>assistant\n<think>\n\n</think>\n\n')).toBe(
      true,
    );
  });

  it('aucun BOS applicatif : le prompt commence par <|im_start|>system', () => {
    const log = new PromptLog('SYS');
    log.appendUser('x');
    expect(log.beginAssistantTurn({ thinking: true }).startsWith('<|im_start|>system')).toBe(true);
  });

  it('le prompt du tour suivant étend octet-pour-octet le précédent + génération', () => {
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

  it('les blocs <think> générés restent verbatim dans l’historique gelé', () => {
    const log = new PromptLog('SYS');
    log.appendUser('Q');
    log.beginAssistantTurn({ thinking: true });
    log.completeAssistantTurn('<think>raisonnement secret</think>Réponse');
    expect(log.frozen).toContain('<think>raisonnement secret</think>Réponse');
  });

  it('basculer thinking entre les tours préserve la propriété de préfixe', () => {
    const log = new PromptLog('SYS');
    log.appendUser('Q1');
    const p1 = log.beginAssistantTurn({ thinking: false });
    log.completeAssistantTurn('R1');
    log.appendUser('Q2');
    const p2 = log.beginAssistantTurn({ thinking: true });
    expect(p2.startsWith(p1 + 'R1' + '<|im_end|>\n')).toBe(true);
  });

  it('PROPRIÉTÉ : sur 30 tours pseudo-aléatoires, chaque prompt est un préfixe strict du suivant', () => {
    // LCG déterministe — pas de Math.random pour un test rejouable.
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

  it('protège l’invariant : beginAssistantTurn deux fois sans complete ⇒ erreur', () => {
    const log = new PromptLog('SYS');
    log.appendUser('Q');
    log.beginAssistantTurn({ thinking: true });
    expect(() => log.beginAssistantTurn({ thinking: true })).toThrow(/tour/);
  });

  it('protège l’invariant : complete sans begin ⇒ erreur', () => {
    const log = new PromptLog('SYS');
    expect(() => log.completeAssistantTurn('R')).toThrow(/tour/);
  });

  it('protège l’invariant : appendUser pendant un tour assistant ouvert ⇒ erreur', () => {
    const log = new PromptLog('SYS');
    log.appendUser('Q');
    log.beginAssistantTurn({ thinking: true });
    expect(() => log.appendUser('Q2')).toThrow(/tour/);
  });
});
