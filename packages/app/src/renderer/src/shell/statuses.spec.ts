/**
 * The memory mark of a sidebar's row: its state and its name, or nothing to
 * name — the row keeps its place.
 */

import { describe, expect, it } from 'vitest';
import { fr } from '../i18n/fr';
import { memoryMarkOf } from './statuses';

describe('the memory marks', () => {
  it('give each state its name, and name nothing where there is no memory', () => {
    expect(memoryMarkOf('engine', fr.shell.memory)).toEqual({ memory: 'engine', name: 'Contexte dans le moteur' });
    expect(memoryMarkOf('saved', fr.shell.memory)).toEqual({ memory: 'saved', name: 'Mémoire sauvée' });
    expect(memoryMarkOf('reread', fr.shell.memory)).toEqual({ memory: 'reread', name: 'À relire' });
    expect(memoryMarkOf(null, fr.shell.memory)).toEqual({ memory: null, name: null });
  });
});
