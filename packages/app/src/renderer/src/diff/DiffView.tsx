/**
 * aparté's diff view (`<aparte-diff>`, `@aparte/plugin-diff`), through React
 * as a component made from its spec: the one place the app draws a change.
 * Given the texts before and after, it computes the diff itself and lets
 * every folded run of lines open. Its colours are the `--aparte-diff-*`
 * tokens.
 */

import '@aparte/plugin-diff';
import { diffElement, type AparteDiffComment, type AparteDiffCommentEventDetail } from '@aparte/plugin-diff';
import { createAparteElement } from '@aparte/react';
import { useMemo } from 'react';

const Diff = createAparteElement(diffElement);

export interface DiffViewProps {
  path: string;
  before: string | null;
  after: string | null;
  /** Lines can be commented (« Commenter le diff », task 6.5). */
  commentable?: boolean;
  comments?: AparteDiffComment[];
  onComment?(detail: AparteDiffCommentEventDetail, event: CustomEvent<AparteDiffCommentEventDetail>): void;
}

export function DiffView({ path, before, after, commentable, comments, onComment }: DiffViewProps) {
  // The same change keeps the same object: the view keeps its folds and what is picked.
  const diff = useMemo(() => ({ path, before, after }), [path, before, after]);
  return (
    <Diff
      className="diff-view"
      diff={diff}
      {...(commentable ? { commentable: true } : {})}
      {...(comments ? { comments } : {})}
      {...(onComment ? { onDiffComment: onComment } : {})}
    />
  );
}
