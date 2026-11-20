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

import { isRefrozen, type JournalEntry } from '../journal/types.js';

/** What the model is asked — sent to the model: English. Never part of the conversation. */
export const SUMMARY_QUESTION =
  'Summarize this conversation so far, for your own use: it will replace the earlier turns in your context. ' +
  'Write two parts. "Facts:" — quote exactly, never paraphrase, each specific fact read in a file, from a tool ' +
  'or from the user that a later turn may need (codes, names, numbers, paths, values, results), one per line. ' +
  '"Work:" — the user’s goal and constraints, the decisions taken and why, the files and code involved, what was ' +
  'done and verified, what failed, what remains to do, briefly. At most 500 words in all; no preamble, no advice ' +
  'to the user.';

/**
 * What the model is asked when the turn under way is folded on itself (review of round 2, 5): its message and its last
 * call stay, its earlier calls go into the summary with the turns before — sent to the model: English.
 */
export const SUMMARY_TURN_QUESTION =
  'Summarize this conversation so far, for your own use: it will replace the earlier turns and your earlier tool ' +
  'calls for the user’s last message in your context; that message and your last call stay as they are. Write three ' +
  'parts. "Facts:" — quote exactly, never paraphrase, each specific fact read in a file, from a tool or from the user ' +
  'that a later step may need (codes, names, numbers, paths, values, results), one per line. "Work:" — the user’s goal ' +
  'and constraints, the decisions taken and why, what was done and verified before, briefly. "Work so far in this ' +
  'turn:" — each call you made for the user’s last message, in order, and what it found. At most 500 words in all; no ' +
  'preamble, no advice to the user.';

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
export function summaryNote(summary: string, turn = false): string {
  const what = turn
    ? 'The earlier turns of this conversation, and your earlier calls for the user’s message below, were compacted to save context.'
    : 'The earlier turns of this conversation were compacted to save context.';
  return `[conversation summary]\n${what} What they established:\n${summary}`;
}

export interface CompactionPlan {
  /** The entries kept as they were frozen, after the summary. */
  kept: readonly JournalEntry[];
  keptTurns: number;
  compactedTurns: number;
  /** What the summary replaces, in tokens. */
  compactedTokens: number;
}

/**
 * The conversation's own part: after the last rebase or change of model, else after its system turns.
 * `folded`: what a change of model rendered again — the conversation before it, folded but never kept.
 */
function conversationPart(entries: readonly JournalEntry[]): { part: readonly JournalEntry[]; folded: readonly JournalEntry[] } {
  const refrozen = entries.findLastIndex(isRefrozen);
  if (refrozen >= 0) {
    return { part: entries.slice(refrozen + 1), folded: entries[refrozen]!.kind === 'engine' ? [entries[refrozen]!] : [] };
  }
  const first = entries.findIndex((entry) => entry.kind !== 'system');
  return { part: first < 0 ? [] : entries.slice(first), folded: [] };
}

/**
 * A compaction that keeps everything from `keepFrom` on, as it was frozen, and folds what came before (audit
 * 2026-11-21, D2): the turn under way when its context ran out — its calls and their results, which the model goes
 * on from — or the last turn when the whole conversation leaves no room for the question and its summary: the
 * summary is then asked of what comes before it, a prefix the engine holds. Not worth it when what it folds is little.
 */
export function planCompactionKeeping(entries: readonly JournalEntry[], keepFrom: string, estimate: (text: string) => number): CompactionPlan {
  if (entries.at(-1)?.kind === 'pending') throw new CompactionError('pending', 'A call waits for an answer: answer it before compacting.');
  const { part, folded } = conversationPart(entries);
  const at = part.findIndex((entry) => entry.id === keepFrom);
  if (at < 0) throw new CompactionError('not-worth', 'What would be kept is not in this part of the conversation: nothing was compacted.');
  const weigh = (list: readonly JournalEntry[]): number => estimate(list.map((entry) => entry.rendered ?? '').join(''));
  const kept = part.slice(at);
  const compactedTokens = weigh([...folded, ...part.slice(0, at)]);
  if (compactedTokens < MIN_COMPACTED_TOKENS) {
    throw new CompactionError('not-worth', 'The conversation is too short for a summary to be worth it: nothing was compacted.');
  }
  const keptTurns = kept.filter((entry) => entry.kind === 'user').length;
  const compactedTurns = part.slice(0, at).filter((entry) => entry.kind === 'user').length;
  return { kept, keptTurns, compactedTurns, compactedTokens };
}

/** What a compaction would fold and keep — or why it is not worth it. */
export function planCompaction(entries: readonly JournalEntry[], estimate: (text: string) => number): CompactionPlan {
  if (entries.at(-1)?.kind === 'pending') throw new CompactionError('pending', 'A call waits for an answer: answer it before compacting.');
  const { part, folded } = conversationPart(entries);
  const weigh = (list: readonly JournalEntry[]): number => estimate(list.map((entry) => entry.rendered ?? '').join(''));
  const starts = part.flatMap((entry, index) => (entry.kind === 'user' ? [index] : []));
  const total = weigh([...folded, ...part]);
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

/** Less than this to fold of a turn's own rounds, and a summary would save nothing. */
export const MIN_FOLDED_ROUND_TOKENS = 256;

/** The turn under way folded on itself: what is kept of it, and where the summary is asked. */
export interface TurnFold extends CompactionPlan {
  /** The turn's message, kept as it was frozen. */
  user: Extract<JournalEntry, { kind: 'user' }>;
  /** The turn's first answer: its rendering opens the model's turn. */
  first: Extract<JournalEntry, { kind: 'assistant' }>;
  /** The last round, kept as it was: the model's last answer (its calls) and their results. */
  round: readonly JournalEntry[];
  /** The summary is asked of the entries before this index: everything before the last round. */
  askedUntil: number;
}

/**
 * The turn under way folded on itself (review of round 2, 5): when what precedes it is not worth folding — a fresh
 * conversation, or a rebase earlier in this same turn — its own earlier rounds are. Its message is kept, its last round
 * (the model's last calls and their results, which it goes on from) is kept, and the summary covers the rest.
 */
export function planTurnFold(entries: readonly JournalEntry[], estimate: (text: string) => number): TurnFold {
  if (entries.at(-1)?.kind === 'pending') throw new CompactionError('pending', 'A call waits for an answer: answer it before compacting.');
  const userAt = entries.findLastIndex((entry) => entry.kind === 'user');
  const lastAt = entries.findLastIndex((entry) => entry.kind === 'assistant');
  const round = entries.slice(lastAt);
  const earlier = entries
    .slice(userAt + 1, lastAt)
    .filter((entry): entry is Extract<JournalEntry, { kind: 'assistant' }> => entry.kind === 'assistant');
  if (userAt < 0 || lastAt <= userAt || earlier.length === 0 || round.length < 2 || !round.slice(1).every((entry) => entry.kind === 'tool-results')) {
    throw new CompactionError('not-worth', 'This turn has no earlier call to fold: nothing was compacted.');
  }
  const { part, folded } = conversationPart(entries.slice(0, lastAt));
  const weigh = (list: readonly JournalEntry[]): number => estimate(list.map((entry) => entry.rendered ?? '').join(''));
  const user = entries[userAt] as Extract<JournalEntry, { kind: 'user' }>;
  const compactedTokens = weigh([...folded, ...part.filter((entry) => entry.id !== user.id)]);
  if (compactedTokens < MIN_FOLDED_ROUND_TOKENS) {
    throw new CompactionError('not-worth', 'This turn has too little to fold for a summary to be worth it: nothing was compacted.');
  }
  return {
    user,
    first: earlier[0]!,
    round,
    askedUntil: lastAt,
    kept: [user, ...round],
    keptTurns: 1,
    compactedTurns: part.filter((entry) => entry.kind === 'user' && entry.id !== user.id).length,
    compactedTokens,
  };
}
