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

export function compareWithJournal(messages: readonly AgentMessage[], entries: readonly JournalEntry[]): Divergence {
  const sent = messages.filter((message) => message.role === 'user').map((message) => messageText(message.content));
  const said = entries.flatMap((entry, index) => (entry.kind === 'user' ? [{ text: entry.text, index }] : []));
  if (sent.length === 0) return { kind: 'mismatch' };

  const differs = sent.findIndex((text, index) => index < said.length && said[index]!.text !== text);
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
