/**
 * How a test finds a conversation in aparté's list (`<aparte-conversation-list>`
 * in the sidebar). aparté documents no selector for a row: it is the element
 * that carries the conversation's id (`data-conv-id`), and its menu is the
 * button named « Actions de la conversation ». A release that moves them
 * breaks this file, not the specs.
 */

import type { Locator, Page } from '@playwright/test';

export function conversationList(page: Page) {
  const list = page.locator('.bonaparte-conversations');
  const row = (title: string): Locator => list.locator('[data-conv-id]').filter({ hasText: title });
  return {
    list,
    row,
    /**
     * The colour of a row's status dot (aparté's `.aparte-conv-item__status`, shown while it waits), and the colour
     * a token resolves to on the page — to compare the two.
     */
    async statusColour(title: string, token: string): Promise<{ dot: string; token: string }> {
      return row(title)
        .locator('.aparte-conv-item__status')
        .evaluate((element, name) => {
          const probe = document.createElement('span');
          probe.style.backgroundColor = `var(${name})`;
          element.append(probe);
          const resolved = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return { dot: getComputedStyle(element).backgroundColor, token: resolved };
        }, token);
    },
    /** Opens the row's menu (rename, pin, archive, delete). */
    async openMenu(title: string, label = 'Actions de la conversation'): Promise<void> {
      await row(title).hover();
      await row(title).getByRole('button', { name: label }).click();
    },
  };
}
