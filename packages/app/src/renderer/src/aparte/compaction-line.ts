/**
 * A compaction the context made necessary (audit 2026-11-21, D2): the core compacts the conversation on its own
 * when a message, or a turn's results, would not fit, and says it as aparté's `compaction` activity
 * ({ before, after }, the tokens the conversation held). This draws it as a line of the answer that stays —
 * nothing paid in silence.
 */

import { aparteGlobalConfig } from '@aparte/core';
import { formatTokens } from '../format';
import type { Messages } from '../i18n/index';

/** The activity's content is the core's, but checked: a number or nothing. */
function figures(content: unknown): { before: number; after: number } {
  const { before, after } = (content ?? {}) as { before?: unknown; after?: unknown };
  const asNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
  return { before: asNumber(before), after: asNumber(after) };
}

export function registerCompactionLine(messages: Messages, locale: string): () => void {
  const say = (root: HTMLElement, content: unknown): void => {
    const { before, after } = figures(content);
    root.textContent = messages.compact.auto(formatTokens(before, locale), formatTokens(after, locale));
  };
  return aparteGlobalConfig.registerActivityRenderer('compaction', {
    render(segment) {
      const root = document.createElement('p');
      root.className = 'compaction-line';
      root.setAttribute('role', 'note');
      root.setAttribute('aria-label', messages.compact.autoLabel);
      say(root, segment.content);
      return root;
    },
    update(element, segment) {
      say(element as HTMLElement, segment.content);
    },
  });
}
