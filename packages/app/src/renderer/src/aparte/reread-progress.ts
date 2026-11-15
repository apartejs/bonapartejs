/**
 * The progress of a conversation read again: the core sends it as aparté's
 * `reread` activity ({ done, total }, the prompt tokens read so far); this
 * draws it with the kit's progress bar, updated in place.
 */

import { aparteGlobalConfig } from '@aparte/core';
import { formatTokens } from '../format';
import type { Messages } from '../i18n/index';

/** The activity's content is the core's, but checked: a number or nothing. */
function figures(content: unknown): { done: number; total: number } {
  const { done, total } = (content ?? {}) as { done?: unknown; total?: unknown };
  const asNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
  return { done: asNumber(done), total: asNumber(total) };
}

export function registerRereadProgress(messages: Messages, locale: string): () => void {
  const update = (root: HTMLElement, content: unknown): void => {
    const { done, total } = figures(content);
    const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    const bar = root.querySelector<HTMLElement>('.aparte-progress');
    bar?.setAttribute('aria-valuenow', String(percent));
    const fill = root.querySelector<HTMLElement>('.aparte-progress__bar');
    if (fill) fill.style.width = `${percent}%`;
    const text = root.querySelector<HTMLElement>('.reread-progress__text');
    if (text) text.textContent = messages.memory.rereadProgress(formatTokens(done, locale), formatTokens(total, locale));
  };
  return aparteGlobalConfig.registerActivityRenderer('reread', {
    render(segment) {
      const root = document.createElement('div');
      root.className = 'reread-progress';
      const bar = document.createElement('div');
      bar.className = 'aparte-progress';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', messages.memory.rereadProgressLabel);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      const fill = document.createElement('div');
      fill.className = 'aparte-progress__bar';
      bar.append(fill);
      const text = document.createElement('p');
      text.className = 'reread-progress__text';
      root.append(bar, text);
      update(root, segment.content);
      return root;
    },
    update(element, segment) {
      update(element as HTMLElement, segment.content);
    },
  });
}
