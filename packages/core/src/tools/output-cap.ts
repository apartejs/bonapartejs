/**
 * A tool's output is cut to a quarter of the context, counted at three
 * characters a token, and never more than 30,000 characters (6,144 for 8,192
 * tokens, 24,576 for 32,768): a long output must not fill the conversation.
 * The cut falls in the middle — a third of what is kept from the head, two
 * thirds from the tail, between two lines when one is near —: a test run, a
 * compiler or a build say what failed, and how they ended, last (audit
 * 2026-11-21, D5). The model is told what it does not see; the result, its
 * note included, is never longer than the cap, so a second cut leaves it be.
 */

const MOST = 30_000;
/** The share of what is kept that comes from the head; the rest is the tail. */
const HEAD_SHARE = 1 / 3;
/** Room kept for the note that says what was left out. */
const NOTE_ROOM = 120;

export function maxToolOutputChars(nCtx: number): number {
  return Math.min(MOST, Math.floor(nCtx / 4) * 3);
}

/** What was already left out between the head and the tail of a content (a command's output past what it kept). */
export interface Omitted {
  characters: number;
  lines: number;
}

const count = (n: number): string => n.toLocaleString('en-US');

/**
 * The content cut to `nCtx`'s cap. `omitted`: the content is a head and a tail joined, this much left out where they
 * meet — which falls in what the cut leaves out, the head and the tail kept being each longer than the cap.
 */
export function capToolOutput(content: string, nCtx: number, omitted?: Omitted): string {
  const max = maxToolOutputChars(nCtx);
  if (content.length <= max && !omitted) return content;
  const kept = Math.max(0, max - NOTE_ROOM);
  const headMax = Math.floor(kept * HEAD_SHARE);
  const tailMax = kept - headMax;
  // The head ends before a line break, the tail starts after one — when one is in the last (first) half of each.
  const headBreak = content.lastIndexOf('\n', headMax);
  const cutFrom = headBreak >= headMax / 2 ? headBreak : headMax;
  const tailStart = Math.max(cutFrom, content.length - tailMax);
  const tailBreak = content.indexOf('\n', tailStart);
  const cutTo = tailBreak !== -1 && tailBreak - tailStart <= tailMax / 2 ? tailBreak + 1 : tailStart;
  const left = content.slice(cutFrom, cutTo);
  const characters = left.length + (omitted?.characters ?? 0);
  const lines = Math.max(0, left.split('\n').length - 2) + (omitted?.lines ?? 0);
  const what = lines > 0 ? `${count(lines)} lines (${count(characters)} characters)` : `${count(characters)} characters`;
  return `${content.slice(0, cutFrom)}\n[The output was cut in the middle: ${what} were left out.]\n${content.slice(cutTo)}`;
}
