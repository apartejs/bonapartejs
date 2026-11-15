/**
 * The deck of live chats (task 5.5): one chat per live conversation — the
 * one shown, those that work or wait for the person, the four seen last —,
 * each bound to its conversation for its whole life. Opening a conversation
 * shows its chat when it lives, else mounts one; the others go.
 */

import { describe, expect, it } from 'vitest';
import { created, forget, mountHidden, newDeck, openIn, prune, shownConversation, type Deck } from './deck';

const keys = (deck: Deck) => deck.chats.map((chat) => `${chat.key}:${chat.conversationId ?? '-'}`);

describe('the deck of live chats', () => {
  it('starts on one new chat; opening a conversation mounts its chat and shows it', () => {
    const deck = newDeck();
    expect(keys(deck)).toEqual(['chat-1:-']);
    expect(shownConversation(deck)).toBeNull();
    const a = openIn(deck, 'A');
    expect(keys(a)).toEqual(['chat-1:-', 'chat-2:A']);
    expect(a.shown).toBe('chat-2');
    expect(shownConversation(a)).toBe('A');
  });

  it('a conversation that lives is shown, never mounted twice', () => {
    const deck = openIn(openIn(newDeck(), 'A'), 'B');
    const back = openIn(deck, 'A');
    expect(back.chats).toBe(deck.chats);
    expect(shownConversation(back)).toBe('A');
    expect(back.recent.slice(0, 2)).toEqual(['chat-2', 'chat-3']);
  });

  it('a new conversation is a new chat, or the empty one that is there', () => {
    const deck = openIn(newDeck(), 'A');
    const fresh = openIn(deck, null);
    expect(fresh.shown).toBe('chat-1');
    expect(fresh.chats).toBe(deck.chats);
    // Its first message made its conversation: the chat keeps it for its whole life.
    const made = created(fresh, 'chat-1', 'C');
    expect(keys(made)).toEqual(['chat-1:C', 'chat-2:A']);
    expect(keys(openIn(made, null))).toEqual(['chat-1:C', 'chat-2:A', 'chat-3:-']);
  });

  it('keeps the chat shown, those that work or wait, and the four seen last; the others go', () => {
    let deck = newDeck();
    for (const id of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) deck = openIn(deck, id);
    // G shown; F, E, D, C the four seen before it; B works; A goes; the empty chat goes.
    const kept = prune(deck, (chat) => chat.conversationId === 'B');
    expect(kept.chats.map((chat) => chat.conversationId)).toEqual(['B', 'C', 'D', 'E', 'F', 'G']);
    expect(kept.recent).not.toContain('chat-2');
    // The one that went comes back as a new chat, from its conversation.
    const again = openIn(kept, 'A');
    expect(shownConversation(again)).toBe('A');
    expect(again.chats.filter((chat) => chat.conversationId === 'A')).toHaveLength(1);
  });

  it('a chat that waits for the person is never let go, however long ago it was seen', () => {
    let deck = openIn(newDeck(), 'P');
    for (const id of ['A', 'B', 'C', 'D', 'E', 'F']) deck = openIn(deck, id);
    const kept = prune(deck, (chat) => chat.conversationId === 'P');
    expect(kept.chats.map((chat) => chat.conversationId)).toContain('P');
  });

  it('the conversations paused before a restart are mounted, not shown; a removed one goes', () => {
    const deck = mountHidden(newDeck(), ['P', 'Q']);
    expect(keys(deck)).toEqual(['chat-1:-', 'chat-2:P', 'chat-3:Q']);
    expect(shownConversation(deck)).toBeNull();
    expect(keys(mountHidden(deck, ['P']))).toEqual(keys(deck));
    const shown = openIn(deck, 'P');
    expect(keys(forget(shown, 'P'))).toEqual(['chat-1:-', 'chat-3:Q']);
    expect(forget(shown, 'P').shown).toBe('chat-1');
  });
});
