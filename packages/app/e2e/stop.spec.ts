/**
 * Stop, end to end: a click in the window cuts the generation on the engine.
 * A reply that keeps being generated after Stop would keep the slot busy, and
 * the graphics card working, for an answer nobody reads.
 */

import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

// About 300 pieces at 50 ms each: fifteen seconds if nothing stops it.
const LONG_REPLY = Array.from({ length: 200 }, (_, index) => `mot${index}`).join(' ');

test('Stop cuts the generation on the engine, and keeps what was written', async ({ launch }) => {
  const { page, server } = await launch({ engine: { responder: () => LONG_REPLY, paceMs: 50 } });
  const ui = chat(page);

  await ui.send('Raconte');
  // Three pieces of four characters have arrived.
  await expect.poll(async () => ((await ui.replyText.textContent()) ?? '').length).toBeGreaterThanOrEqual(12);
  expect(server.aborted).toBe(0);

  await ui.stopButton.click();

  // Within a second, the engine has seen the request go.
  await expect.poll(() => server.aborted, { timeout: 1_000 }).toBe(1);
  // The reply is over, as it was: its text kept, nothing reported as a failure.
  await expect(ui.streamingReplies).toHaveCount(0);
  await expect(ui.stopButton).toHaveCount(0);
  await expect(ui.errors).toHaveCount(0);
  const kept = ((await ui.replyText.textContent()) ?? '').trim();
  expect(kept.length).toBeGreaterThanOrEqual(12);
  expect(kept.length).toBeLessThan(LONG_REPLY.length);
  expect(LONG_REPLY.startsWith(kept)).toBe(true);
  // And nothing more is written.
  await page.waitForTimeout(400);
  expect(((await ui.replyText.textContent()) ?? '').trim()).toBe(kept);
});

test('the conversation goes on after a stop', async ({ launch }) => {
  let turn = 0;
  const { page, server } = await launch({
    engine: {
      responder: () => {
        turn += 1;
        return turn === 1 ? LONG_REPLY : 'Me revoila.';
      },
      paceMs: 50,
    },
  });
  const ui = chat(page);

  await ui.send('Raconte');
  await expect.poll(async () => ((await ui.replyText.textContent()) ?? '').length).toBeGreaterThanOrEqual(12);
  await ui.stopButton.click();
  await expect.poll(() => server.aborted, { timeout: 1_000 }).toBe(1);
  await expect(ui.stopButton).toHaveCount(0);

  await ui.send('Et maintenant ?');

  await expect(ui.replies).toHaveCount(2);
  await expect(ui.replyText).toHaveText('Me revoila.');
  await expect(ui.errors).toHaveCount(0);
  expect(server.aborted).toBe(1);
});
