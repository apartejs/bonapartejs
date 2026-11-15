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
