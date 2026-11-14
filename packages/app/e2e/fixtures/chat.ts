/**
 * How a test finds its way in aparté's chat.
 *
 * The library documents no hook for tests (apartejs/aparte#203). These
 * selectors were read in its source (1.7.0) and checked against the installed
 * build; they live here, in one place, so that a release that moves one breaks
 * one file. When the library names the hooks a test may rely on, use those.
 *
 * Everything is in the light DOM. `<AparteChat>` renders a
 * `div[data-aparte-chat]`; each message is an `<aparte-chat-bubble>`; the
 * composer's field is a `contenteditable` whose accessible name is its
 * placeholder; and one button both sends and stops (`data-act`).
 */

import type { Locator, Page } from '@playwright/test';

export interface ChatDriver {
  /** The field the person types in, by its accessible name: the placeholder. */
  composer(name: string): Locator;
  editor: Locator;
  /** One button, two jobs: it sends, and it stops while a reply streams. */
  sendButton: Locator;
  stopButton: Locator;
  userMessages: Locator;
  replies: Locator;
  /** The text of the last reply. */
  replyText: Locator;
  /** The replies still being written. */
  streamingReplies: Locator;
  errors: Locator;
  send(text: string): Promise<void>;
}

export function chat(page: Page): ChatDriver {
  const editor = page.locator('aparte-composer-input .aparte-ci-editor');
  const sendButton = page.locator('aparte-composer-send button[data-act="send"]');
  return {
    composer: (name) => page.getByRole('textbox', { name }),
    editor,
    sendButton,
    stopButton: page.locator('aparte-composer-send button[data-act="stop"]'),
    userMessages: page.locator('aparte-chat-bubble[data-role="user"]'),
    replies: page.locator('aparte-chat-bubble[data-role="assistant"]'),
    replyText: page
      .locator('aparte-chat-bubble[data-role="assistant"] .aparte-segment-text .aparte-segment-content')
      .last(),
    streamingReplies: page.locator(
      'aparte-chat-bubble[data-role="assistant"] .aparte-message[data-streaming="true"]',
    ),
    errors: page.locator('.aparte-segment-error'),

    async send(text) {
      await editor.fill(text);
      await sendButton.click();
    },
  };
}
