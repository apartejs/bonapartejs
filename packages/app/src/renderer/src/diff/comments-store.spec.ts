/**
 * The comments on a diff (board « Commenter le diff », task 6.5): kept by
 * the app — aparté's view only shows them —, pending until they leave
 * together, as one message; changed or cleared before that.
 */

import { describe, expect, it } from 'vitest';
import { fr } from '../i18n/fr';
import { addComment, clearPending, editComment, markSent, pendingOf, reviewMessage, summaryOf, type ReviewComment } from './comments-store';

const at = (path: string, line: number, text: string) => ({ path, side: 'new' as const, startLine: line, endLine: line, text, code: '' });

describe('the comments on a diff', () => {
  it('kept pending, counted by file; changed; sent together as one message, the lines first', () => {
    let review: ReviewComment[] = [];
    review = addComment(review, at('src/format.ts', 5, 'Arrondis au quart d’heure.'), 'c1');
    review = addComment(review, at('src/format.ts', 6, 'Ajoute un test pour minuit.'), 'c2');
    review = addComment(review, { ...at('src/format.test.ts', 18, 'Nomme le test en français.'), endLine: 19 }, 'c3');
    expect(summaryOf(review)).toEqual({ count: 3, files: 2 });
    review = editComment(review, 'c2', 'Ajoute un test pour minuit : 0 minute donne 0.');
    expect(reviewMessage(pendingOf(review), fr)).toBe(
      [
        '3 commentaires sur le diff :',
        'src/format.ts:5 — Arrondis au quart d’heure.',
        'src/format.ts:6 — Ajoute un test pour minuit : 0 minute donne 0.',
        'src/format.test.ts:18-19 — Nomme le test en français.',
      ].join('\n'),
    );
    review = markSent(review);
    expect(summaryOf(review)).toEqual({ count: 0, files: 0 });
    expect(review.map((comment) => comment.state)).toEqual(['sent', 'sent', 'sent']);
  });

  it('« Tout effacer » takes the pending ones away, never the sent ones', () => {
    let review = markSent(addComment([], at('a.ts', 1, 'parti'), 'c1'));
    review = addComment(review, at('a.ts', 2, 'en attente'), 'c2');
    expect(clearPending(review).map((comment) => comment.id)).toEqual(['c1']);
  });
});
