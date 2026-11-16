/**
 * What the sidebar shows of each conversation (§12), asked of the core: its
 * project, where its memory is, whether it waits for the person. The bridge
 * pushes nothing, so the page asks again when something may have changed it:
 * the end of a reply, a conversation loaded or chosen, an approval answered.
 *
 * Two marks follow from it on aparté's rows:
 * - the memory: a mark of the row (aparté's `renderMeta`), named, read after
 *   the title and drawn before it;
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

export type Memory = ConversationStatusView['memory'];

/** What a row's memory mark says: its state and its name, or nothing to name. */
export function memoryMarkOf(memory: Memory, words: Messages['shell']['memory']): { memory: Memory; name: string | null } {
  return { memory, name: memory ? words[memory] : null };
}

/** The marks of a row: its memory (drawn before the title), its branch and its files (after it). */
export function rowMarks(memory: Memory, branchFiles: number | undefined, words: Messages, pr?: RowPr, unread = false): HTMLElement {
  const marks = document.createElement('span');
  marks.className = 'conv-marks';
  marks.append(memoryMark(memory, words.shell.memory));
  if (unread) {
    // A reply finished since the person last looked (task 8.4): a blue dot, named.
    const mark = document.createElement('span');
    mark.className = 'conv-unread';
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', words.shell.unread);
    marks.append(mark);
  }
  if (branchFiles !== undefined) {
    const branch = document.createElement('span');
    branch.className = 'conv-branch';
    branch.setAttribute('role', 'img');
    branch.setAttribute('aria-label', words.branches.mark(branchFiles));
    branch.innerHTML = BRANCH_GLYPH;
    branch.append(String(branchFiles));
    marks.append(branch);
  }
  if (pr && pr.state !== 'closed') {
    const mark = document.createElement('span');
    const merged = pr.state === 'merged';
    mark.className = `conv-pr conv-pr--${merged ? 'merged' : (pr.ci ?? 'none')}`;
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', merged ? words.pr.markMerged : words.pr.markOpen(pr.number, pr.ci));
    mark.innerHTML = merged ? MERGED_GLYPH : PR_GLYPH;
    if (!merged) mark.append(String(pr.number));
    marks.append(mark);
  }
  return marks;
}

/** A branch's pull request, as a row shows it. */
export interface RowPr {
  number: number;
  state: 'open' | 'merged' | 'closed';
  ci: 'success' | 'failure' | 'pending' | null;
}

/** A pull request, and one merged: the shell's own glyphs (constant markup). */
const PR_GLYPH =
  '<svg class="aparte-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M6 8v8"/><path d="M18 16V9a3 3 0 0 0-3-3h-4"/><path d="m13 3-3 3 3 3"/></svg>';
const MERGED_GLYPH =
  '<svg class="aparte-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 8v8"/><path d="M6 8a6 6 0 0 0 6 4h4"/></svg>';

/** A git branch, the shell's own glyph (constant markup). */
const BRANCH_GLYPH =
  '<svg class="aparte-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10"/><path d="M18 9a6 6 0 0 1-6 6H8"/></svg>';

/** The mark itself; a row without memory keeps its place, with nothing to read. */
export function memoryMark(memory: Memory, words: Messages['shell']['memory']): HTMLElement {
  const mark = memoryMarkOf(memory, words);
  const element = document.createElement('span');
  element.className = 'conv-memory';
  if (mark.memory && mark.name) {
    element.dataset['memory'] = mark.memory;
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', mark.name);
  } else {
    element.setAttribute('aria-hidden', 'true');
  }
  return element;
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
