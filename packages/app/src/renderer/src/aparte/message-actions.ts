/**
 * The buttons of a message (board « Revenir en arrière », task 7.2). On the
 * person's messages: aparté's « Modifier » and « Copier », and ours — « Revenir
 * avant » and « Brancher »; on the answers: « Copier » and « Réessayer ». Ours
 * are aparté's registered actions: a click sends `aparte-action`, which the
 * app answers. Ours show their icon and their words, as the board draws
 * them: « Revenir avant » before aparté's buttons, « Brancher » after them
 * (`display`, `position`: aparté 1.11, apartejs/aparte#241).
 */

import { aparteGlobalConfig } from '@aparte/core';
import type { Messages } from '../i18n/index';

export const REWIND_ACTION = 'bonaparte-rewind';
export const BRANCHES_ACTION = 'bonaparte-branches';

/** Back before: an arrow turning back (constant markup, the kit's stroke). */
const UNDO_GLYPH =
  '<svg class="aparte-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
/** A branch parting. */
const BRANCH_GLYPH =
  '<svg class="aparte-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>';

/** The buttons, said in the interface's language; what it returns takes ours away. */
export function setupMessageActions(words: Messages['rewind']): () => void {
  aparteGlobalConfig.setBubbleActions({ user: ['edit', 'copy'], assistant: ['copy', 'retry'] });
  aparteGlobalConfig.registerAction({
    id: REWIND_ACTION,
    icon: UNDO_GLYPH,
    label: words.action,
    display: 'both',
    position: 'start',
    zones: ['bubble'],
    bubble: { roles: ['user'] },
  });
  aparteGlobalConfig.registerAction({
    id: BRANCHES_ACTION,
    icon: BRANCH_GLYPH,
    label: words.branchesAction,
    display: 'both',
    position: 'end',
    zones: ['bubble'],
    bubble: { roles: ['user'] },
  });
  return () => {
    aparteGlobalConfig.unregisterAction(REWIND_ACTION);
    aparteGlobalConfig.unregisterAction(BRANCHES_ACTION);
  };
}
