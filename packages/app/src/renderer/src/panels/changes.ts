/**
 * The counts of a change (« +4 −4 »): the lines added and removed, as
 * aparté's diff counts them (`diffTexts`, DOM-free).
 */

import { diffTexts } from '@aparte/plugin-diff';

export interface LineCounts {
  added: number;
  removed: number;
}

export function countLines(before: string | null, after: string | null): LineCounts {
  if (before === null && after === null) return { added: 0, removed: 0 };
  const file = diffTexts(before, after);
  return { added: file.added, removed: file.removed };
}

export function total(counts: readonly LineCounts[]): LineCounts {
  return counts.reduce((sum, one) => ({ added: sum.added + one.added, removed: sum.removed + one.removed }), { added: 0, removed: 0 });
}
