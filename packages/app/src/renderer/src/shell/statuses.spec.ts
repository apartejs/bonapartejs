/**
 * The memory dots of the sidebar's rows: one rule per conversation that has a
 * memory, its name given as CSS alt text, its id escaped — none for a
 * conversation without memory.
 */

import { describe, expect, it } from 'vitest';
import { fr } from '../i18n/fr';
import { memoryMarksCss } from './statuses';

describe('the memory dots', () => {
  it('give each state its name, and draw none where there is no memory', () => {
    const css = memoryMarksCss(
      {
        a: { projectId: null, memory: 'engine', waiting: false },
        b: { projectId: null, memory: 'saved', waiting: false },
        c: { projectId: 'p', memory: 'reread', waiting: true },
        d: { projectId: null, memory: null, waiting: false },
      },
      fr.shell.memory,
    );
    expect(css).toContain('[data-conv-id="a"] .aparte-conv-item__select::after { content: "" / "Contexte dans le moteur";');
    expect(css).toContain('"Mémoire sauvée"');
    expect(css).toContain('"À relire"; background: transparent;');
    expect(css).not.toContain('"d"');
  });

  it('escapes an id that is not a plain word', () => {
    const css = memoryMarksCss({ '1"x': { projectId: null, memory: 'saved', waiting: false } }, fr.shell.memory);
    expect(css).toContain('[data-conv-id="1\\"x"]');
  });
});
