/**
 * A message written while a reply runs waits for it (board « Une conversation avec des sous-agents au travail »:
 * « ton message attendra »; aparté 1.12, apartejs/aparte#248): Enter puts it above the field, and it goes when
 * the reply ends — after a Stop it comes back into the field instead.
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

test('a message written while a reply runs waits above the field, and goes when the reply ends', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => 'un deux trois quatre cinq six sept huit neuf dix', paceMs: 120 } });
  const ui = chat(page);
  await ui.send('Compte jusqu’à dix');
  await expect(ui.streamingReplies).toHaveCount(1, { timeout: 10_000 });
  await ui.composerBox.click();
  await page.keyboard.type('Et maintenant à l’envers');
  await page.keyboard.press('Enter');
  // Waiting, said as such — not in the thread yet.
  await expect(page.getByText('Envoyé à la fin de la réponse')).toBeVisible();
  await expect(ui.userMessages).toHaveCount(1);
  // The reply over, it goes.
  await expect(ui.userMessages).toHaveCount(2, { timeout: 20_000 });
  await expect(ui.userMessages.nth(1)).toContainText('Et maintenant à l’envers');
});
