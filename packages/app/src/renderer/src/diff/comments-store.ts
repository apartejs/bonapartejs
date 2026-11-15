/**
 * The comments on a diff (board « Commenter le diff », task 6.5). aparté's
 * view keeps nothing: the app keeps them, each pending until they all leave
 * together, in one message — the lines first, `path:line — text` — and sent
 * after. A pending one can be changed, and « Tout effacer » takes the
 * pending ones away.
 */

import type { AparteDiffComment, AparteDiffCommentEventDetail } from '@aparte/plugin-diff';
import type { Messages } from '../i18n/index';

export type ReviewComment = AparteDiffComment & { id: string; state: 'pending' | 'sent' };

export function addComment(review: readonly ReviewComment[], detail: AparteDiffCommentEventDetail, id: string): ReviewComment[] {
  const { path, side, startLine, endLine, text } = detail;
  return [...review, { id, path, side, startLine, endLine, text, state: 'pending' }];
}

export function editComment(review: readonly ReviewComment[], id: string, text: string): ReviewComment[] {
  return review.map((comment) => (comment.id === id && comment.state === 'pending' ? { ...comment, text } : comment));
}

export function clearPending(review: readonly ReviewComment[]): ReviewComment[] {
  return review.filter((comment) => comment.state !== 'pending');
}

export function markSent(review: readonly ReviewComment[]): ReviewComment[] {
  return review.map((comment) => ({ ...comment, state: 'sent' }));
}

export function pendingOf(review: readonly ReviewComment[]): ReviewComment[] {
  return review.filter((comment) => comment.state === 'pending');
}

export function summaryOf(review: readonly ReviewComment[]): { count: number; files: number } {
  const pending = pendingOf(review);
  return { count: pending.length, files: new Set(pending.map((comment) => comment.path)).size };
}

/** Where a comment is: `path:5`, or `path:5-7` for several lines. */
export function whereOf(comment: Pick<AparteDiffComment, 'path' | 'startLine' | 'endLine'>): string {
  return `${comment.path}:${comment.startLine}${comment.endLine > comment.startLine ? `-${comment.endLine}` : ''}`;
}

/** The one message the comments leave in. */
export function reviewMessage(pending: readonly ReviewComment[], messages: Messages): string {
  return [messages.review.message(pending.length), ...pending.map((comment) => `${whereOf(comment)} — ${comment.text}`)].join('\n');
}
