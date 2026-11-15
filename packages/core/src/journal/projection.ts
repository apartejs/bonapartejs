/**
 * aparté's document of a conversation, rebuilt from its journal (task 5.4):
 * when the page's own document is missing — lost, or never saved —, the
 * person's messages and the answers' text, in order, from the branch the
 * conversation shows. The journal is the truth of what was said; this is
 * the plainest way to show it. The reasoning and the calls' syntax are read
 * through the family's demux and left out; a reply of several rounds of
 * tools is one answer.
 */

import type { FamilyLayer } from '../families/types.js';
import type { JournalEntry } from './types.js';

export interface ProjectedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** An answer's text, as a segment: how the page draws one. */
  segments?: { id: string; type: 'text'; content: string }[];
}

export interface ProjectedConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ProjectedMessage[];
  /** aparté's tree of the messages: one branch, the last one its head. */
  tree: { headId: string | null; messages: { message: ProjectedMessage; parentId: string | null }[] };
}

/** The text an answer showed: what the family's demux reads as text, nothing else. */
function textOf(raw: string, family: FamilyLayer): string {
  const demux = family.createDemux();
  return [...demux.push(raw), ...demux.flush()]
    .map((piece) => (piece.type === 'text' ? piece.delta : ''))
    .join('');
}

export function projectToAparte(
  meta: { id: string; title: string; createdAt: string; updatedAt: string },
  entries: readonly JournalEntry[],
  family: FamilyLayer,
): ProjectedConversation {
  const withdrawn = new Set(entries.flatMap((entry) => (entry.kind === 'withdrawn' ? [entry.entryId] : [])));
  const messages: ProjectedMessage[] = [];
  for (const entry of entries) {
    const timestamp = Date.parse(entry.at) || 0;
    if (entry.kind === 'user') {
      if (withdrawn.has(entry.id)) continue;
      messages.push({ id: entry.id, role: 'user', content: entry.text, timestamp });
    } else if (entry.kind === 'assistant') {
      const text = textOf(entry.raw, family);
      const last = messages.at(-1);
      // The rounds of one reply are one answer.
      if (last?.role === 'assistant') last.content = `${last.content}${text}`;
      else messages.push({ id: entry.messageId ?? entry.id, role: 'assistant', content: text, timestamp });
    }
  }
  for (const message of messages) {
    message.content = message.content.trim();
    // An answer is drawn as the page draws one: its text a segment.
    if (message.role === 'assistant') message.segments = [{ id: `${message.id}-text`, type: 'text', content: message.content }];
  }
  const shown = messages.filter((message) => message.role === 'user' || message.content !== '');
  return {
    id: meta.id,
    title: meta.title,
    createdAt: Date.parse(meta.createdAt) || 0,
    updatedAt: Date.parse(meta.updatedAt) || 0,
    messages: shown,
    // One branch: the page's tree of it, so that no older tree it kept is drawn instead.
    tree: {
      headId: shown.at(-1)?.id ?? null,
      messages: shown.map((message, index) => ({ message, parentId: index === 0 ? null : shown[index - 1]!.id })),
    },
  };
}
