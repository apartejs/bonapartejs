import { describe, expect, it } from 'vitest';
import { renderSystem, renderUser } from './template.js';

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
