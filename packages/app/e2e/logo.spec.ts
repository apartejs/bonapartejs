/**
 * The mascot in the app (task 12.2, board « Logo et ses états »): in the sidebar's header and in the rail, its name
 * says its state; it writes while the reply is written, is content once it ends, and sleeps once the model is
 * unloaded; the pointer over it surprises it.
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

const LONG_REPLY = Array.from({ length: 120 }, (_, index) => `mot${index}`).join(' ');

test('the mascot says what the conversation shown is doing: writing, then content, then at rest; surprised under the pointer', async ({ launch }) => {
  const { page } = await launch({ engine: { responder: () => LONG_REPLY, paceMs: 40 } });
  const ui = chat(page);
  const mark = page.locator('.bonaparte-sidebar .mascot');
  await expect(mark).toHaveAttribute('aria-label', 'Logo bonaparte, au repos');
  await expect(mark).toHaveAttribute('role', 'img');
  // Its face is text, never an image.
  await expect(mark.locator('.mascot__face')).toHaveText("('.')");

  await ui.send('Raconte');
  await expect(mark).toHaveAttribute('data-state', 'talking', { timeout: 15_000 });
  await expect(mark.locator('.mascot__face')).toHaveText("('o')");
  await expect(ui.streamingReplies).toHaveCount(0, { timeout: 30_000 });
  await expect(mark).toHaveAttribute('data-state', 'happy');
  await expect(mark).toHaveAttribute('aria-label', 'Logo bonaparte, content');
  await expect(mark).toHaveAttribute('data-state', 'idle', { timeout: 5_000 });

  await mark.hover();
  await expect(mark).toHaveAttribute('data-state', 'surprised');
  await page.mouse.move(600, 600);
  await expect(mark).toHaveAttribute('data-state', 'idle');

  // Folded into the rail, it is still there.
  await page.keyboard.press('Control+B');
  await expect(page.locator('.bonaparte-rail .mascot')).toHaveAttribute('data-state', 'idle');
});

test('the mascot waits with the conversation when a request waits for the person', async ({ launch }) => {
  const { page } = await launch({
    engine: {
      responder: (prompt: string) =>
        prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user') ? 'Fait.' : '<|tool_call>call:write_file{path:<|"|>notes.txt<|"|>,content:<|"|>x<|"|>}<tool_call|>',
    },
  });
  await chat(page).send('Écris la note');
  const mark = page.locator('.bonaparte-sidebar .mascot');
  await expect(page.getByRole('region', { name: 'Demande d’accord' })).toBeVisible({ timeout: 15_000 });
  await expect(mark).toHaveAttribute('data-state', 'waiting');
  await expect(mark).toHaveAttribute('aria-label', 'Logo bonaparte, attend ton accord');
});
