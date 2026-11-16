/**
 * What the person did, read from the history aparté's client sends with each
 * turn against the journal, which is the truth. Only the person's messages
 * are compared: an answer in the window is what the model wrote once its
 * reasoning and its calls were taken out, never its raw text.
 *
 * - `append`: the same history, and one message more.
 * - `retry`: the same history, ending on the person's last message: its
 *   answer is asked again — a branch after that message.
 * - `edit`: a message changed: a branch where it stood, the new text from there.
 * - `mismatch`: not this conversation's history (the window answers 409).
 */

import type { JournalEntry } from '../journal/types.js';
import { messageText, type AgentMessage } from './body.js';

export type Divergence =
  | { kind: 'append'; text: string }
  | { kind: 'retry'; afterEntryId: string }
  | { kind: 'edit'; afterEntryId: string; text: string }
  | { kind: 'mismatch' };

/**
 * `opening`: what the history opens with in place of the turns before its checkpoint, as aparté names it
 * (`_meta.historySummary`, aparté 1.11, apartejs/aparte#243).
 */
export function compareWithJournal(messages: readonly AgentMessage[], entries: readonly JournalEntry[], opening?: string): Divergence {
  // After a compaction the page sends from its checkpoint (aparté's `contextSummary`): the turns the rebase
  // kept, then what came after it — compared with those; a page without the checkpoint sends everything.
  const rebase = entries.findLastIndex((entry) => entry.kind === 'rebase');
  if (rebase >= 0) {
    const { keptFrom } = entries[rebase] as Extract<JournalEntry, { kind: 'rebase' }>;
    const kept = keptFrom ? entries.findIndex((entry) => entry.id === keptFrom) : -1;
    const shortened = compare(messages, entries, kept >= 0 ? kept : rebase + 1, opening);
    if (shortened.kind !== 'mismatch') return shortened;
  }
  return compare(messages, entries, 0);
}

/**
 * The page's messages of the person against the journal's from `from` on. `opening`: what aparté sends
 * first after its checkpoint, as a message of the person's — the summary alone, or joined to the first
 * message kept after a blank line; it is no message of theirs, and is taken off.
 */
function compare(messages: readonly AgentMessage[], entries: readonly JournalEntry[], from: number, opening?: string): Divergence {
  const sent = messages.filter((message) => message.role === 'user').map((message) => messageText(message.content));
  if (opening && sent[0]?.startsWith(opening)) {
    const rest = sent[0].slice(opening.length).replace(/^\n\n/, '');
    if (rest === '') sent.shift();
    else sent[0] = rest;
  }
  const said = entries.flatMap((entry, index) => (entry.kind === 'user' && index >= from ? [{ text: entry.text, index }] : []));
  if (sent.length === 0) return { kind: 'mismatch' };

  const differs = sent.findIndex(
    (text, index) => index < said.length && text !== said[index]!.text,
  );
  if (differs < 0) {
    if (sent.length === said.length + 1) return { kind: 'append', text: sent.at(-1)! };
    if (sent.length === said.length && messages.at(-1)?.role === 'user') {
      return { kind: 'retry', afterEntryId: entries[said.at(-1)!.index]!.id };
    }
    return { kind: 'mismatch' };
  }
  if (sent.length !== differs + 1) return { kind: 'mismatch' };
  // The branch goes on from the entry before the message that changed.
  const before = entries[said[differs]!.index - 1];
  return before ? { kind: 'edit', afterEntryId: before.id, text: sent[differs]! } : { kind: 'mismatch' };
}
