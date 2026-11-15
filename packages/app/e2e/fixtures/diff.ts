/**
 * aparté's diff view (`<aparte-diff>`), as a test drives it: a line's
 * number (a click opens the comment field), the field, the comments it
 * shows. Its hooks live here alone — a release that moves one breaks this
 * file, not the specs.
 */

import type { Locator } from '@playwright/test';

export function diffView(scope: Locator) {
  return {
    /** The number of a line on one side: `new` for an added or kept line, `old` for a removed one. */
    lineNumber: (side: 'old' | 'new', line: number): Locator =>
      scope.locator(`.aparte-diff-line__num[data-side="${side}"]`).filter({ hasText: new RegExp(`^${line}$`) }).first(),
    commentField: scope.locator('.aparte-diff-form__input'),
    comments: scope.locator('.aparte-diff-comment'),
  };
}
