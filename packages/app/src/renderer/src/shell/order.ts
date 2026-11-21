/**
 * The order of the conversations' list: the one the person wrote in last first, or made last.
 *
 * aparté's manager orders by `updatedAt`, the time its page last wrote a conversation back — and a reply is written
 * back once revealed: a reply that ended in another conversation, after the person wrote in this one, put that
 * other one above, until this one's reply ended (shortcuts.spec.ts:19, 2026-11-21). Rows that move under the
 * person, and Ctrl ↑ ↓ going where they did not look. The person's own messages move a row; a reply, being
 * opened, a title or a going back move none. The core keeps the same time on each card (`personAt`), so that the
 * list reads the same before its messages are loaded, and after a restart. aparté's side: apartejs/aparte#293.
 */

import { lastWrittenAt } from '@aparte/bonaparte-shared';

export interface Ordered {
  id: string;
  createdAt?: number;
  updatedAt?: number;
  /** From the core's card: when the person last wrote in it, before its messages are loaded. */
  personAt?: number;
  messages?: readonly unknown[];
}

/** When the person last wrote in a conversation, or made it. */
export function activityAt(conversation: Ordered): number {
  return Math.max(conversation.createdAt ?? 0, conversation.personAt ?? 0, lastWrittenAt(conversation) ?? 0) || (conversation.updatedAt ?? 0);
}

/**
 * The conversations in the list's order, each with that time as `updatedAt` — aparté's list groups its rows by
 * it. `reached` keeps the latest time each one reached: a going back takes messages away, never the row's place.
 */
export function inActivityOrder<T extends Ordered>(conversations: readonly T[], reached: Map<string, number>): T[] {
  const timed = conversations.map((conversation) => {
    const at = Math.max(activityAt(conversation), reached.get(conversation.id) ?? 0);
    reached.set(conversation.id, at);
    return { conversation, at };
  });
  return timed
    .sort((a, b) => b.at - a.at)
    .map(({ conversation, at }) => (conversation.updatedAt === at ? conversation : { ...conversation, updatedAt: at }));
}
