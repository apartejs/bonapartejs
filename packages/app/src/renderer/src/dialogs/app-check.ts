/**
 * Why the app's own update could not be checked, said in « Mises à jour » (audit 2026-11-21, N4). The main process
 * names the reason (`checkFailure`); the window says it in the person's language.
 */

import type { AppCheckView } from '@aparte/bonaparte-shared';
import type { Messages } from '../i18n/index';

export function appCheckLine(words: Messages['updates'], failure: AppCheckView): string {
  const why = words.appCheckWhy;
  switch (failure.reason) {
    case 'private':
      return words.appCheck(why.private);
    case 'offline':
      return words.appCheck(why.offline);
    case 'unpublished':
      return words.appCheck(why.unpublished);
    case 'refused':
      return words.appCheck(why.refused(failure.status ?? 403));
    case 'other':
      // The updater's own first line; an error without one still says what it was.
      return words.appCheck(why.other(failure.detail || 'Error', failure.status));
  }
}
