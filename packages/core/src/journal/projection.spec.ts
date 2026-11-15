/**
 * aparté's document of a conversation, rebuilt from its journal when the
 * page's own is missing (task 5.4): the person's messages and the answers'
 * text, in order — the journal stays the truth of what was said. The
 * reasoning and the calls' syntax are not text; a reply made of several
 * rounds of tools is one answer.
 */

import { describe, expect, it } from 'vitest';
import { familyLayer } from '../families/index.js';
import type { JournalEntry } from './types.js';
import { projectToAparte } from './projection.js';

const at = '2026-11-15T10:00:00.000Z';
let n = 0;
const entry = (fields: Record<string, unknown>): JournalEntry => ({ id: `e${++n}`, at, rendered: '', ...fields }) as JournalEntry;

describe('projectToAparte', () => {
  it("gives the page's messages back from the journal: the person's, then the answers' text", () => {
    const gemma = familyLayer('gemma');
    const entries = [
      entry({ kind: 'system' }),
      entry({ kind: 'user', text: 'Bonjour', messageId: 'u1' }),
      entry({ kind: 'assistant', raw: '<|channel>thought\nIl salue.<channel|>Bonjour Paul.', messageId: 'a1' }),
      entry({ kind: 'user', text: 'Lis a.ts', messageId: 'u2' }),
      entry({ kind: 'assistant', raw: '<|tool_call>call:read_file{path:<|"|>a.ts<|"|>}<tool_call|>', messageId: 'a2' }),
      entry({ kind: 'tool-results', results: [{ toolCallId: 'c', name: 'read_file', content: 'x' }] }),
      entry({ kind: 'assistant', raw: 'Le fichier exporte a.', messageId: 'a2' }),
    ];
    const document = projectToAparte({ id: 'c1', title: 'Bonjour', createdAt: at, updatedAt: at }, entries, gemma);
    expect(document).toMatchObject({ id: 'c1', title: 'Bonjour' });
    expect(document.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'Bonjour'],
      ['assistant', 'Bonjour Paul.'],
      ['user', 'Lis a.ts'],
      ['assistant', 'Le fichier exporte a.'],
    ]);
    expect(document.messages[0]!.id).toBe('u1');
  });

  it('a message withdrawn is not shown again', () => {
    const user = entry({ kind: 'user', text: 'Trop long', messageId: 'u1' });
    const document = projectToAparte({ id: 'c1', title: '', createdAt: at, updatedAt: at }, [user, entry({ kind: 'withdrawn', entryId: user.id })], familyLayer('gemma'));
    expect(document.messages).toEqual([]);
  });
});
