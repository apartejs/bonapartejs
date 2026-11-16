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
  /**
   * A sub-agent's line (aparté's plugin-subagents, task 8.2): the row of its run_subagent call — its name in
   * `.aparte-tool-name`, its second line (its step, its count) in `.aparte-tool-activity`.
   */
  subagentLine(name: string): Locator;
  /** A question in the composer's place: the panel aparté's composer stamps `data-aparte-panel`. */
  question: Locator;
  /** The mode the switch shows: its combobox, whose text is the shown value (aparté's testing guide). */
  modeShown: Locator;
  send(text: string): Promise<void>;
}

export function chat(page: Page): ChatDriver {
  // Several chats live in the page (task 5.5): the one shown.
  const root = page.locator('.bonaparte-live-chat:not([hidden]) [data-aparte-chat]');
  // The composer's own field: a form above it (a new conversation's branch) has fields too.
  const editor = root.locator('aparte-composer [role="textbox"][contenteditable="true"]');
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
    subagentLine: (name) =>
      replies
        .locator('.aparte-segment-tool-call[data-tool-name="run_subagent"]')
        .filter({ has: root.page().locator('.aparte-tool-name', { hasText: name }) }),
    question: root.locator('aparte-composer [data-aparte-panel]'),
    modeShown: root.page().locator('aparte-approval-mode aparte-select [role="combobox"]'),

    async send(text) {
      await editor.fill(text);
      await sendButton.click();
    },
  };
}
