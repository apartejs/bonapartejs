/**
 * How a test finds its way in aparté's chat: the stable contract aparté
 * documents since 1.9 (« Testing your chat », apartejs/aparte#203) — the
 * chat's root `[data-aparte-chat]`, the field by its role and its name (the
 * placeholder), `aparte-composer-send[data-act]` for Send and Stop,
 * `aparte-chat-bubble[data-role]` for a message, `[aria-busy="true"]` inside
 * a reply still being written, `[data-error-code]` for a turn that failed.
 * One thing reads past it: the text of a reply's answer, without its
 * reasoning, is the text segment's content.
 */

import type { Locator, Page } from '@playwright/test';

export interface ChatDriver {
  /** The field the person types in, by its accessible name: the placeholder. */
  composer(name: string): Locator;
  editor: Locator;
  /** The box the composer draws: the axis the rest of the column follows. */
  composerBox: Locator;
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
  /** The line of a tool's call in a reply: aparté keeps the tool's name on it, for a test. */
  toolLine(name: string): Locator;
  /** A question in the composer's place: the panel aparté's composer stamps `data-aparte-panel`. */
  question: Locator;
  /**
   * The mode the switch shows. Its combobox's text holds every option too (a hidden sizer that
   * keeps its width): read the label, never the combobox's whole text.
   */
  modeShown: Locator;
  send(text: string): Promise<void>;
}

export function chat(page: Page): ChatDriver {
  const root = page.locator('[data-aparte-chat]');
  const editor = root.getByRole('textbox');
  const sendButton = root.locator('aparte-composer-send[data-act="send"] button');
  const replies = root.locator('aparte-chat-bubble[data-role="assistant"]');
  return {
    composer: (name) => root.getByRole('textbox', { name }),
    editor,
    composerBox: root.locator('aparte-composer .aparte-composer-shell'),
    sendButton,
    stopButton: root.locator('aparte-composer-send[data-act="stop"] button'),
    userMessages: root.locator('aparte-chat-bubble[data-role="user"]'),
    replies,
    // Outside the contract: the answer's text alone, apart from the reasoning.
    replyText: replies.locator('.aparte-segment-text .aparte-segment-content').last(),
    streamingReplies: replies.locator('[aria-busy="true"]'),
    errors: root.locator('[data-error-code]'),
    toolLine: (name) => replies.locator(`[data-tool-name="${name}"]`),
    question: root.locator('aparte-composer [data-aparte-panel]'),
    modeShown: root.page().locator('aparte-approval-mode .aparte-select-label-text'),

    async send(text) {
      await editor.fill(text);
      await sendButton.click();
    },
  };
}
