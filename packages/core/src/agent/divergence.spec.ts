/**
 * aparté's client sends the whole history with each turn; the journal is the
 * truth. Comparing the two says what the person did: wrote a new message,
 * asked for the last answer again, changed an earlier message — or sent a
 * history that is not this conversation's.
 */

import { describe, expect, it } from 'vitest';
import type { JournalEntry } from '../journal/types.js';
import type { AgentMessage } from './body.js';
import { compareWithJournal } from './divergence.js';

let n = 0;
const entry = (body: Partial<JournalEntry> & Pick<JournalEntry, 'kind'>): JournalEntry =>
  ({ id: `e${++n}`, at: '2026-11-14T00:00:00.000Z', ...body }) as JournalEntry;

const JOURNAL: JournalEntry[] = [
  entry({ kind: 'system', rendered: 'S' }),
  entry({ kind: 'system', rendered: 'P' }),
  entry({ kind: 'user', text: 'Bonjour' }),
  entry({ kind: 'assistant', raw: 'Bonjour Paul.' }),
  entry({ kind: 'user', text: 'Et ensuite ?' }),
  entry({ kind: 'assistant', raw: 'On continue.' }),
];

const user = (text: string): AgentMessage => ({ role: 'user', content: text });
const assistant = (text: string): AgentMessage => ({ role: 'assistant', content: text });

describe('compareWithJournal', () => {
  it('a new message after the same history is appended', () => {
    const messages = [user('Bonjour'), assistant('Bonjour Paul.'), user('Et ensuite ?'), assistant('On continue.'), user('Merci')];
    expect(compareWithJournal(messages, JOURNAL)).toEqual({ kind: 'append', text: 'Merci' });
    expect(compareWithJournal([user('Premier')], JOURNAL.slice(0, 2))).toEqual({ kind: 'append', text: 'Premier' });
  });

  it('the same history sent again asks for the last answer again: a branch after the last message', () => {
    const messages = [user('Bonjour'), assistant('Bonjour Paul.'), user('Et ensuite ?')];
    expect(compareWithJournal(messages, JOURNAL)).toEqual({ kind: 'retry', afterEntryId: JOURNAL[4]!.id });
  });

  it('a message changed: a branch where it was, and the new text from there', () => {
    const messages = [user('Bonjour'), assistant('Bonjour Paul.'), user('Autre chose')];
    expect(compareWithJournal(messages, JOURNAL)).toEqual({ kind: 'edit', afterEntryId: JOURNAL[3]!.id, text: 'Autre chose' });
    expect(compareWithJournal([user('Salut')], JOURNAL)).toEqual({ kind: 'edit', afterEntryId: JOURNAL[1]!.id, text: 'Salut' });
  });

  it('a message whose answer failed comes back joined to the next one: the journal kept the next one, and the history goes on', () => {
    // aparté 1.9 drops a message whose answer failed from the next request, then joins it to the
    // following message (two messages of the person in a row become one, with a blank line).
    // The journal never kept it (refused before anything ran), or kept it on a branch an edit left.
    const messages = [
      user('Bonjour'),
      assistant('Bonjour Paul.'),
      user('Un message trop long\n\nEt ensuite ?'),
      assistant('On continue.'),
      user('Merci'),
    ];
    expect(compareWithJournal(messages, JOURNAL)).toEqual({ kind: 'append', text: 'Merci' });
  });

  it('a history that is not this conversation is a mismatch', () => {
    expect(compareWithJournal([user('Autre'), assistant('x'), user('y')], JOURNAL)).toEqual({ kind: 'mismatch' });
    expect(compareWithJournal([user('a'), assistant('b'), user('c')], JOURNAL.slice(0, 2))).toEqual({ kind: 'mismatch' });
    expect(compareWithJournal([assistant('no message of the person')], JOURNAL)).toEqual({ kind: 'mismatch' });
  });

  it('reads a message whose text arrives in parts: an inlined file is part of it', () => {
    const parts: AgentMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'Bonjour' },
      ],
    };
    expect(compareWithJournal([parts, assistant('Bonjour Paul.'), user('Et ensuite ?'), assistant('x'), user('Merci')], JOURNAL)).toEqual({
      kind: 'append',
      text: 'Merci',
    });
  });
});
