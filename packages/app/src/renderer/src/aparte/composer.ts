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

/** Puts a text in the composer, the cursor after it: the person sends it, or changes it first. */
export function prefill(text: string): boolean {
  const field = composer();
  if (!field) return false;
  field.setValue(text);
  field.focus();
  return true;
}

/** Gives the person the composer. */
export function focusComposer(): void {
  composer()?.focus();
}

/**
 * What frees the composer for a message: the end of a reply, or of the question that held it — and
 * a conversation loaded, the one the message waits for perhaps. aparté dispatches them on the chat,
 * bubbling.
 */
const FREED = ['aparte-message-done', 'aparte-message-aborted', 'aparte-message-error', 'aparte-conversation-loaded'] as const;

/**
 * Sends as the person as soon as the composer is free and `here()` (the conversation it belongs to
 * is the one open): now, or when the reply — or the question — that holds the composer ends, or
 * when the person comes back to that conversation. Never into another one, never lost; the
 * function returned gives it up.
 */
export function sendWhenFree(text: string, here: () => boolean, page: EventTarget = window): () => void {
  if (here() && sendAsPerson(text)) return () => undefined;
  let done = false;
  const stop = (): void => {
    done = true;
    for (const name of FREED) page.removeEventListener(name, retry);
  };
  function retry(): void {
    // After aparté's own listeners: the composer is free, and the conversation open, only once they have run.
    setTimeout(() => {
      if (!done && here() && sendAsPerson(text)) stop();
    }, 0);
  }
  for (const name of FREED) page.addEventListener(name, retry);
  return stop;
}
