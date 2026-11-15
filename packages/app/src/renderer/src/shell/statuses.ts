/**
 * What the sidebar shows of each conversation (§12), asked of the core: its
 * project, where its memory is, whether it waits for the person. The bridge
 * pushes nothing, so the page asks again when something may have changed it:
 * the end of a reply, a conversation loaded or chosen, an approval answered.
 *
 * Two marks follow from it on aparté's rows, which accept nothing of ours
 * (apartejs/aparte#229):
 * - the memory: a dot drawn by a stylesheet regenerated here, keyed on the
 *   row's `data-conv-id`, its name given as CSS alt text — read after the
 *   title, drawn before it;
 * - the wait: aparté's own `waiting` state of a row, told on the window as
 *   aparté's controller tells it, for the conversations the core says wait
 *   (after a restart, aparté knows nothing of a pause).
 */

import { conversationsStatus, type ConversationStatusView } from '@aparte/bonaparte-shared';
import { useEffect, useRef, useState } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';

export type Statuses = Record<string, ConversationStatusView>;

const MAY_CHANGE = [
  'aparte-message-done',
  'aparte-message-aborted',
  'aparte-message-error',
  'aparte-conversation-loaded',
  'aparte-conversation-select',
] as const;

/** The ids the core can be asked about at once (the channel's limit). */
const MAX_IDS = 500;

export function useConversationStatuses(ids: readonly string[], pulse: number): Statuses {
  const [statuses, setStatuses] = useState<Statuses>({});
  const key = ids.slice(0, MAX_IDS).join('\n');
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const asked = key === '' ? [] : key.split('\n');
    const ask = (): void => {
      if (asked.length === 0) {
        setStatuses({});
        return;
      }
      bridge
        .invoke(conversationsStatus, { ids: asked })
        .then((found) => {
          // The same answer keeps the same object: nothing is drawn again for it.
          if (alive) setStatuses((was) => (JSON.stringify(was) === JSON.stringify(found) ? was : found));
        })
        .catch(() => undefined);
    };
    const soon = (): void => {
      clearTimeout(timer);
      timer = setTimeout(ask, 150);
    };
    soon();
    for (const name of MAY_CHANGE) window.addEventListener(name, soon);
    return () => {
      alive = false;
      clearTimeout(timer);
      for (const name of MAY_CHANGE) window.removeEventListener(name, soon);
    };
  }, [key, pulse]);
  return statuses;
}

/** A CSS string: quoted, its quotes and backslashes escaped, no line break. */
function cssString(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, ' ')}"`;
}

/** The memory dots: one rule per conversation that has a memory, its name as alt text. */
export function memoryMarksCss(statuses: Statuses, words: Messages['shell']['memory']): string {
  const look = {
    engine: 'background: var(--aparte-success); border-color: var(--aparte-success);',
    saved: 'background: var(--aparte-text-muted); border-color: var(--aparte-text-muted);',
    reread: 'background: transparent; border-color: var(--aparte-text-muted);',
  } as const;
  return Object.entries(statuses)
    .flatMap(([id, status]) =>
      status.memory
        ? [
            `.bonaparte-sidebar [data-conv-id=${cssString(id)}] .aparte-conv-item__select::after { content: "" / ${cssString(
              words[status.memory],
            )}; ${look[status.memory]} }`,
          ]
        : [],
    )
    .join('\n');
}

export function useMemoryMarks(statuses: Statuses, words: Messages['shell']['memory']): void {
  const sheet = useRef<HTMLStyleElement | null>(null);
  useEffect(() => {
    const style = document.createElement('style');
    style.dataset['bonaparte'] = 'memory-marks';
    document.head.append(style);
    sheet.current = style;
    return () => {
      style.remove();
      sheet.current = null;
    };
  }, []);
  useEffect(() => {
    if (sheet.current) sheet.current.textContent = memoryMarksCss(statuses, words);
  }, [statuses, words]);
}

/** aparté's `waiting` state, for the conversations the core says wait; taken back only where it was told here. */
export function useWaitingMarks(statuses: Statuses): void {
  const told = useRef(new Set<string>());
  useEffect(() => {
    const tell = (id: string, status: 'waiting' | null): void => {
      window.dispatchEvent(new CustomEvent('aparte-conversation-status', { detail: { id, status } }));
    };
    for (const [id, status] of Object.entries(statuses)) {
      if (status.waiting && !told.current.has(id)) {
        told.current.add(id);
        tell(id, 'waiting');
      } else if (!status.waiting && told.current.has(id)) {
        told.current.delete(id);
        tell(id, null);
      }
    }
  }, [statuses]);
}
