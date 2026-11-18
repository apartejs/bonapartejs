/**
 * aparté's diff view (`<aparte-diff>`, `@aparte/plugin-diff`), through React
 * as a component made from its spec: the one place the app draws a change.
 * Given the texts before and after, it computes the diff itself and lets
 * every folded run of lines open. Its colours are the `--aparte-diff-*`
 * tokens. The same change, or the same comments, handed again at a render of
 * the app draw nothing: the folds and a comment being written stay (aparté
 * 1.12.1, apartejs/aparte#253).
 */

import '@aparte/plugin-diff';
import { diffElement, type AparteDiffComment, type AparteDiffCommentEventDetail } from '@aparte/plugin-diff';
import { createAparteElement } from '@aparte/react';

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
  return (
    <Diff
      className="diff-view"
      diff={{ path, before, after }}
      {...(commentable ? { commentable: true } : {})}
      {...(comments ? { comments } : {})}
      {...(onComment ? { onDiffComment: onComment } : {})}
    />
  );
}
