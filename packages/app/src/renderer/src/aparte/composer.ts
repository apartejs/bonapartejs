/**
 * The person's composer, driven from the window: a message sent in their
 * name (the go-ahead of a launched plan), the focus given back to them. Through
 * the composer's public API (`setValue`, `submit`, `focus`), so the send is
 * aparté's own — its gates, its event, its client. Several chats live in the
 * page (task 5.5): the composer is the shown chat's, unless one is named.
 */

import type { AparteComposerToken } from '@aparte/core';

export type Composer = HTMLElement & {
  value: string;
  streaming: boolean;
  panelActive: boolean;
  setValue(value: string): void;
  submit(): void;
};

/** The composer of the chat shown. */
export function shownComposer(): Composer | null {
  return document.querySelector<Composer>('.bonaparte-live-chat:not([hidden]) [data-aparte-chat] aparte-composer');
}

/** A send in the person's name is under way: what the page's hold reads (the engine unloaded). */
let speaking = false;

/** Whether the send under way is one made in the person's name (`sendAsPerson`), not one they typed. */
export function speakingForThePerson(): boolean {
  return speaking;
}

/** The engine is ready again: a message in the person's name that the page held goes now. */
export const ENGINE_READY = 'bonaparte-engine-ready';

/** Sends a message as the person, keeping what they were writing; false when the composer is busy (a reply, a question). */
export function sendAsPerson(text: string, field: Composer | null = shownComposer()): boolean {
  if (!field || field.streaming || field.panelActive) return false;
  const draft = field.value;
  field.setValue(text);
  speaking = true;
  try {
    field.submit();
  } finally {
    speaking = false;
  }
  // Sent, aparté empties the field. Held by the page (the engine unloaded), it leaves it as it was: the person's
  // draft comes back, never the message in its place, and the message waits (check of aparté 1.12).
  const sent = field.value !== text;
  if (!sent || draft.trim() !== '') field.setValue(draft);
  return sent;
}

/** Puts a text in the composer, the cursor after it: the person sends it, or changes it first. */
export function prefill(text: string, field: Composer | null = shownComposer()): boolean {
  if (!field) return false;
  field.setValue(text);
  field.focus();
  return true;
}

/** aparté's editor inside the composer: where a pill goes. */
interface ComposerEditor {
  focusEnd(): void;
  getCaret(): { offset: number } | null;
  insertToken(from: number, to: number, token: AparteComposerToken): void;
}

/**
 * Something of the page attached to the message (task 10.2): a pill after what the person is writing — it shows
 * its label, and the message says its `text` in its place. The composer has no method for it: the pill goes in
 * through its editor, at a caret placed at the end (apartejs/aparte#259).
 */
export function attachToken(token: AparteComposerToken, field: Composer | null = shownComposer()): boolean {
  const editor = field?.querySelector('aparte-composer-input') as unknown as ComposerEditor | null | undefined;
  if (!editor) return false;
  editor.focusEnd();
  const at = editor.getCaret()?.offset;
  if (at === undefined) return false;
  editor.insertToken(at, at, token);
  return true;
}

/** Gives the person the composer. */
export function focusComposer(field: Composer | null = shownComposer()): void {
  field?.focus();
}

/**
 * What frees the composer for a message: the end of a reply, or of the question that held it — and
 * a conversation loaded, the one the message waits for perhaps. aparté dispatches them on the chat,
 * bubbling. And the engine ready again, after the page held the message (the window says it).
 */
const FREED = ['aparte-message-done', 'aparte-message-aborted', 'aparte-message-error', 'aparte-conversation-loaded', ENGINE_READY] as const;

/**
 * Sends as the person, into the composer `target` names, as soon as it is free: now, or when the
 * reply — or the question — that holds it ends. Its chat lives while it works (task 5.5), shown or
 * not: the message is never sent into another conversation, never lost. The function returned
 * gives it up.
 */
export function sendWhenFree(text: string, target: () => Composer | null, page: EventTarget = window): () => void {
  if (sendAsPerson(text, target())) return () => undefined;
  let done = false;
  const stop = (): void => {
    done = true;
    for (const name of FREED) page.removeEventListener(name, retry);
  };
  function retry(): void {
    // After aparté's own listeners: the composer is free only once they have run.
    setTimeout(() => {
      if (!done && sendAsPerson(text, target())) stop();
    }, 0);
  }
  for (const name of FREED) page.addEventListener(name, retry);
  return stop;
}
