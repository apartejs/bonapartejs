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

  it('a message whose answer failed goes joined to the next one: the journal keeps it as it was sent', () => {
    // Since aparté 1.10 a message whose answer failed goes with the next one, joined with a blank
    // line, in every later request: the history no longer changes from one request to the next.
    const joined = 'Un message trop long\n\nEt ensuite ?';
    const before = JOURNAL.slice(0, 4);
    expect(compareWithJournal([user('Bonjour'), assistant('Bonjour Paul.'), user(joined)], before)).toEqual({
      kind: 'append',
      text: joined,
    });
    const after = [...before, entry({ kind: 'user', text: joined }), entry({ kind: 'assistant', raw: 'On continue.' })];
    const messages = [user('Bonjour'), assistant('Bonjour Paul.'), user(joined), assistant('On continue.'), user('Merci')];
    expect(compareWithJournal(messages, after)).toEqual({ kind: 'append', text: 'Merci' });
  });

  it("an earlier message that is not the journal's, even ending as the journal's does, is a mismatch", () => {
    // aparté 1.9 dropped a failed message from one request and joined it to the next in the one
    // after (apartejs/aparte#213): the history changed under the journal. 1.10 sends it the same
    // way every time, so an earlier message that differs is not this conversation's history.
    const messages = [
      user('Bonjour'),
      assistant('Bonjour Paul.'),
      user('Un message trop long\n\nEt ensuite ?'),
      assistant('On continue.'),
      user('Merci'),
    ];
    expect(compareWithJournal(messages, JOURNAL)).toEqual({ kind: 'mismatch' });
  });

  it('a paragraph added in front of the last message is an edit of it, not the same message', () => {
    const messages = [user('Bonjour'), assistant('Bonjour Paul.'), user('Un mot de contexte.\n\nEt ensuite ?')];
    expect(compareWithJournal(messages, JOURNAL)).toEqual({
      kind: 'edit',
      afterEntryId: JOURNAL[3]!.id,
      text: 'Un mot de contexte.\n\nEt ensuite ?',
    });
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

  it('after a compaction, the page sends from its checkpoint — the turns kept, then a new message: appended', () => {
    const kept = JOURNAL[4]!;
    const compacted = [...JOURNAL, entry({ kind: 'rebase', summary: 'Ils se sont salués.', keptFrom: kept.id })];
    expect(compareWithJournal([user('Et ensuite ?'), assistant('On continue.'), user('Merci')], compacted)).toEqual({ kind: 'append', text: 'Merci' });
    // A page without the checkpoint (read again from the journal) sends everything: understood too.
    expect(compareWithJournal([user('Bonjour'), assistant('Bonjour Paul.'), user('Et ensuite ?'), assistant('On continue.'), user('Merci')], compacted)).toEqual({
      kind: 'append',
      text: 'Merci',
    });
    // Nothing kept: the checkpoint sits on the last answer, and the page sends only what follows it.
    const none = [...JOURNAL, entry({ kind: 'rebase', summary: 'Tout.' })];
    expect(compareWithJournal([assistant('On continue.'), user('Merci')], none)).toEqual({ kind: 'append', text: 'Merci' });
  });
});
