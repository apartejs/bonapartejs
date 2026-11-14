/**
 * What a click on a link of a reply does: it never replaces the page.
 *
 * The window is one page, and the conversation lives in it. Before the browser
 * follows a link of a message, aparté asks (`aparte-link-click`, which bubbles
 * and can be refused); the answer here is no. Opening a file of the project in
 * its pane, and a site in the system browser, arrive with the panes and with
 * the list of allowed addresses.
 *
 * `<AparteChat>` has no prop for this event (apartejs/aparte#205), hence a
 * listener on the page: the event bubbles up to it.
 *
 * The main process refuses the navigation too (`isOwnPage`): this is the first
 * of two locks, and the one that keeps the browser from even trying.
 */
export function keepLinksInTheWindow(page: EventTarget = document): () => void {
  const refuse = (event: Event): void => event.preventDefault();
  page.addEventListener('aparte-link-click', refuse);
  return () => page.removeEventListener('aparte-link-click', refuse);
}
