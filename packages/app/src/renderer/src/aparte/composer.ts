/**
 * The person's composer, driven from the window: a message sent in their
 * name (the go-ahead of a launched plan), the focus given back to them. Through
 * the composer's public API (`setValue`, `submit`, `focus`), so the send is
 * aparté's own — its gates, its event, its client.
 */

type Composer = HTMLElement & { value: string; streaming: boolean; panelActive: boolean; setValue(value: string): void; submit(): void };

function composer(): Composer | null {
  return document.querySelector<Composer>('[data-aparte-chat] aparte-composer');
}

/** Sends a message as the person, keeping what they were writing; false when the composer is busy (a reply, a question). */
export function sendAsPerson(text: string): boolean {
  const field = composer();
  if (!field || field.streaming || field.panelActive) return false;
  const draft = field.value;
  field.setValue(text);
  field.submit();
  if (draft.trim()) field.setValue(draft);
  return true;
}

/** Gives the person the composer. */
export function focusComposer(): void {
  composer()?.focus();
}

/** What ends a reply, or a question, that holds the composer: aparté dispatches them on the chat, bubbling. */
const FREED = ['aparte-message-done', 'aparte-message-aborted', 'aparte-message-error'] as const;

/**
 * Sends as the person as soon as the composer is free: now, or when the reply — or the question —
 * that holds it ends. `still()` says whether it is still wanted (the same conversation is open);
 * the function returned gives it up.
 */
export function sendWhenFree(text: string, still: () => boolean, page: EventTarget = window): () => void {
  if (!still()) return () => undefined;
  if (sendAsPerson(text)) return () => undefined;
  let done = false;
  const stop = (): void => {
    done = true;
    for (const name of FREED) page.removeEventListener(name, retry);
  };
  function retry(): void {
    // After aparté's own listeners: the composer is free only once they have run.
    setTimeout(() => {
      if (done) return;
      if (!still()) stop();
      else if (sendAsPerson(text)) stop();
    }, 0);
  }
  for (const name of FREED) page.addEventListener(name, retry);
  return stop;
}
