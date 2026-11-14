/**
 * The window is one page, and the conversation lives in it. A reply may hold
 * links — a coding agent names files all the time — and following one would
 * replace the page. aparté asks before the browser follows a link
 * (`aparte-link-click`, cancelable): the window answers no.
 */

import { describe, expect, it } from 'vitest';
import { keepLinksInTheWindow } from './links';

/** aparté's question, as the message asks it: an event that can be refused. */
const linkClick = (): Event => new Event('aparte-link-click', { bubbles: true, cancelable: true });

describe('keepLinksInTheWindow', () => {
  it('refuses to follow a link of a reply', () => {
    const page = new EventTarget();
    keepLinksInTheWindow(page);
    const event = linkClick();
    page.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves every other event alone', () => {
    const page = new EventTarget();
    keepLinksInTheWindow(page);
    const event = new Event('click', { bubbles: true, cancelable: true });
    page.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('stops answering once it is told to', () => {
    const page = new EventTarget();
    const stop = keepLinksInTheWindow(page);
    stop();
    const event = linkClick();
    page.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
