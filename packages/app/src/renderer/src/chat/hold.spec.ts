/**
 * A conversation's chat held down while going back (task 7.2; the browser redo, step 2, third review): its hold
 * ends whatever happens to the chat's return, and the panes are only ever the held conversation's while its
 * stand-in is the one shown.
 */

import { describe, expect, it, vi } from 'vitest';
import { bringBack, paneConversationOf, type BringBackDeps } from './hold';

function deps(load: BringBackDeps['load']) {
  const done: string[] = [];
  const given: BringBackDeps = {
    load,
    replaceMessages: vi.fn(async () => void done.push('replace')),
    mount: (id) => void done.push(`mount:${id}`),
    release: (id) => void done.push(`release:${id}`),
    settled: async () => undefined,
  };
  return { given, done };
}

describe('a chat held down while going back', () => {
  it('comes back on the branch the core shows, and its hold ends', async () => {
    const { given, done } = deps(async () => ({ messages: [{ id: 'm1' }], tree: null }));
    await bringBack(given, 'A');
    expect(done).toEqual(['replace', 'mount:A', 'release:A']);
  });

  it('its hold ends even when the branch cannot be read: the panes never stay the rewound conversation’s', async () => {
    const { given, done } = deps(async () => {
      throw new Error('the core is gone');
    });
    await expect(bringBack(given, 'A')).rejects.toThrow('the core is gone');
    expect(done).toEqual(['release:A']);
  });

  it('the panes are the held conversation’s only while its stand-in is shown; another conversation shown is followed', () => {
    expect(paneConversationOf('A', null)).toBe('A');
    expect(paneConversationOf('A', 'A')).toBe('A');
    expect(paneConversationOf('A', 'B')).toBe('B');
    expect(paneConversationOf(null, 'B')).toBe('B');
    expect(paneConversationOf(null, null)).toBeNull();
  });
});
