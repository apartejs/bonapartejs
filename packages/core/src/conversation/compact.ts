/**
 * Compaction is a rebase (task 7.3; the restart's invariant: "a rebase is an
 * explicit event, never a side effect"). The model summarises the
 * conversation; a `rebase` entry then freezes the system prompt again with
 * the truth of the moment (its tools, its folders, its instructions, its
 * reply language — every note folded in), the summary as a note, and the
 * last two turns as they were frozen when they weigh little. The prompt of
 * the branch starts again from it; the turns before stay in the journal,
 * the truth of what was said.
 *
 * Ported from the first implementation's lessons: a summary cut or empty is
 * refused, never committed; keeping a long last turn beside its summary
 * saves nothing; a conversation too short for it is left as it is.
 */

import type { JournalEntry } from '../journal/types.js';

/** What the model is asked — sent to the model: English. Never part of the conversation. */
export const SUMMARY_QUESTION =
  'Summarize this conversation so far, for your own use: it will replace the earlier turns in your context. ' +
  'Keep what the work needs to continue — the user’s goal and constraints, the decisions taken and why, ' +
  'the files and code involved (paths, names), what was done and verified, what failed, what remains to do. ' +
  'Be factual and complete; no preamble, no advice to the user.';

/** The longest summary asked for. */
export const SUMMARY_MAX_TOKENS = 1536;
/** Less to fold than this, and the summary would weigh about what it replaces: not worth it. */
export const MIN_COMPACTED_TOKENS = 2 * SUMMARY_MAX_TOKENS;
/** The turns kept as they were, when they weigh at most a third of the conversation. */
export const KEPT_TURNS = 2;

/** Why a compaction did not happen — what the window says, in its language. */
export type CompactionRefusal = 'pending' | 'not-worth' | 'no-room' | 'cut' | 'empty';

/** The compaction did not happen: the conversation is as it was. */
export class CompactionError extends Error {
  constructor(
    readonly code: CompactionRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'CompactionError';
  }
}

/** The summary as the model reads it after the rebase — English. */
export function summaryNote(summary: string): string {
  return `[conversation summary]\nThe earlier turns of this conversation were compacted to save context. What they established:\n${summary}`;
}

export interface CompactionPlan {
  /** The entries kept as they were frozen, after the summary. */
  kept: readonly JournalEntry[];
  keptTurns: number;
  compactedTurns: number;
  /** What the summary replaces, in tokens. */
  compactedTokens: number;
}

/** The conversation's own part: after the last rebase, else after its system turns. */
function conversationPart(entries: readonly JournalEntry[]): readonly JournalEntry[] {
  const rebase = entries.findLastIndex((entry) => entry.kind === 'rebase');
  if (rebase >= 0) return entries.slice(rebase + 1);
  const first = entries.findIndex((entry) => entry.kind !== 'system');
  return first < 0 ? [] : entries.slice(first);
}

/** What a compaction would fold and keep — or why it is not worth it. */
export function planCompaction(entries: readonly JournalEntry[], estimate: (text: string) => number): CompactionPlan {
  if (entries.at(-1)?.kind === 'pending') throw new CompactionError('pending', 'A call waits for an answer: answer it before compacting.');
  const part = conversationPart(entries);
  const weigh = (list: readonly JournalEntry[]): number => estimate(list.map((entry) => entry.rendered ?? '').join(''));
  const starts = part.flatMap((entry, index) => (entry.kind === 'user' ? [index] : []));
  const total = weigh(part);
  let keptAt = part.length;
  if (starts.length > KEPT_TURNS) {
    const from = starts[starts.length - KEPT_TURNS]!;
    // Kept beside their summary only when they weigh little: a long last turn kept saves nothing.
    if (weigh(part.slice(from)) * 3 <= total) keptAt = from;
  }
  const kept = part.slice(keptAt);
  const keptTurns = kept.filter((entry) => entry.kind === 'user').length;
  const compactedTokens = total - weigh(kept);
  if (compactedTokens < MIN_COMPACTED_TOKENS) {
    throw new CompactionError('not-worth', 'The conversation is too short for a summary to be worth it: nothing was compacted.');
  }
  return { kept, keptTurns, compactedTurns: starts.length - keptTurns, compactedTokens };
}
