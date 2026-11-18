/**
 * The shortcuts of the app (task 12.1, board « Réglages · Raccourcis »): each action has its default keys and its
 * group; what the person changed replaces a default; a key typed is read as one combination, whatever the
 * keyboard's layout says of a letter's case; a combination two actions would share is refused, naming the other.
 */

import { describe, expect, it } from 'vitest';
import { actionFor, bindingsOf, comboOf, conflictOf, keysOf, SHORTCUTS, usable } from './registry';

const key = (init: Partial<KeyboardEventInit> & { key: string }) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init });

describe('the shortcuts', () => {
  it('have the defaults of the plan, in their groups', () => {
    const defaults = Object.fromEntries(SHORTCUTS.map((one) => [one.id, one.keys]));
    expect(defaults).toEqual({
      newConversation: 'Ctrl+N',
      search: 'Ctrl+K',
      inbox: 'Ctrl+J',
      sidebar: 'Ctrl+B',
      previousConversation: 'Ctrl+ArrowUp',
      nextConversation: 'Ctrl+ArrowDown',
      cycleMode: 'Ctrl+Shift+M',
      rewindLast: 'Ctrl+Alt+Z',
      changes: 'Ctrl+Shift+D',
      terminal: 'Ctrl+`',
      browser: 'Ctrl+Shift+B',
      newTab: 'Ctrl+T',
    });
    expect(new Set(SHORTCUTS.map((one) => one.group))).toEqual(new Set(['conversations', 'agent', 'panes']));
  });

  it('read a key typed as one combination: modifiers in order, a letter in capitals, a lone modifier as nothing', () => {
    expect(comboOf(key({ key: 'm', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+M');
    expect(comboOf(key({ key: 'M', shiftKey: true, ctrlKey: true }))).toBe('Ctrl+Shift+M');
    expect(comboOf(key({ key: 'z', ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+Z');
    expect(comboOf(key({ key: 'ArrowUp', ctrlKey: true }))).toBe('Ctrl+ArrowUp');
    expect(comboOf(key({ key: '`', ctrlKey: true }))).toBe('Ctrl+`');
    // « + » is the separator: its key is named.
    expect(comboOf(key({ key: '+', ctrlKey: true }))).toBe('Ctrl+Plus');
    expect(comboOf(key({ key: 'Control', ctrlKey: true }))).toBeNull();
    expect(comboOf(key({ key: 'Shift', shiftKey: true }))).toBeNull();
    // A Mac's ⌘ is the Ctrl of the shortcuts.
    expect(comboOf(key({ key: 'k', metaKey: true }))).toBe('Ctrl+K');
  });

  it('take what the person changed over a default; an empty one leaves the action without keys', () => {
    const bindings = bindingsOf({ cycleMode: 'Ctrl+Alt+M', changes: '' });
    expect(bindings.cycleMode).toBe('Ctrl+Alt+M');
    expect(bindings.changes).toBe('');
    expect(bindings.search).toBe('Ctrl+K');
    expect(actionFor(bindings, 'Ctrl+Alt+M')).toBe('cycleMode');
    expect(actionFor(bindings, 'Ctrl+Shift+M')).toBeNull();
    expect(actionFor(bindings, '')).toBeNull();
    // An unknown action kept in the file is ignored.
    expect(bindingsOf({ gone: 'Ctrl+Q' } as Record<string, string>)).not.toHaveProperty('gone');
  });

  it('refuse a combination another action holds, naming it', () => {
    const bindings = bindingsOf({});
    expect(conflictOf(bindings, 'cycleMode', 'Ctrl+K')).toBe('search');
    expect(conflictOf(bindings, 'search', 'Ctrl+K')).toBeNull();
    expect(conflictOf(bindings, 'cycleMode', 'Ctrl+Alt+M')).toBeNull();
  });

  it('take only a combination with Ctrl or Alt: a key alone, or with Maj, is what the person types (review 12)', () => {
    for (const combo of ['Ctrl+N', 'Alt+Z', 'Ctrl+Shift+M', 'Ctrl+`']) expect(usable(combo)).toBe(true);
    for (const combo of ['N', 'Tab', 'Enter', 'Shift+Enter', 'Shift+A', 'F5']) expect(usable(combo)).toBe(false);
  });

  it('show a combination as its keys, in the person’s words', () => {
    const words = { Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Maj', Meta: 'Win', ArrowUp: '↑', ArrowDown: '↓', Enter: 'Entrée', Escape: 'Échap' };
    expect(keysOf('Ctrl+Shift+M', words)).toEqual(['Ctrl', 'Maj', 'M']);
    expect(keysOf('Ctrl+ArrowUp', words)).toEqual(['Ctrl', '↑']);
    expect(keysOf('', words)).toEqual([]);
  });
});
