/**
 * A turn of conversation, end to end: the window posts it to
 * `bonaparte://app/agent`, the core asks the engine, and the answer comes back
 * as it is generated.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures/app.js';
import { chat } from './fixtures/chat.js';

test('the agent endpoint streams: the first piece arrives long before the last', async ({ launch }) => {
  const reply = 'un deux trois quatre cinq six sept huit neuf dix onze douze';
  // 100 ms between two pieces: the whole answer takes more than a second.
  const { page } = await launch({ engine: { responder: () => reply, paceMs: 100 } });

  const seen = await page.evaluate(async () => {
    const response = await fetch('bonaparte://app/agent/c/wire', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        v: 1,
        messageId: 'm1',
        request: { messages: [{ role: 'user', content: 'Compte' }] },
        clientTools: [],
      }),
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const started = performance.now();
    const arrivals: number[] = [];
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arrivals.push(performance.now() - started);
      text += decoder.decode(value, { stream: true });
    }
    return { status: response.status, type: response.headers.get('content-type'), arrivals, text };
  });

  expect(seen.status).toBe(200);
  expect(seen.type).toContain('application/x-ndjson');
  const events = seen.text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { type: string; delta?: string });
  expect(events[0]?.type).toBe('run-start');
  expect(events.at(-1)?.type).toBe('run-done');
  expect(
    events
      .filter((event) => event.type === 'text-delta')
      .map((event) => event.delta)
      .join(''),
  ).toBe(reply);
  // Streamed, not delivered in one block at the end.
  expect(seen.arrivals.length).toBeGreaterThanOrEqual(4);
  expect(seen.arrivals.at(-1)! - seen.arrivals[0]!).toBeGreaterThan(500);
});

test('a reply is on the page while the engine is still writing it', async ({ launch }) => {
  const reply = 'Bonjour Paul, voici une phrase assez longue pour arriver en plusieurs morceaux.';
  // 150 ms between two words: the engine needs close to two seconds for the whole answer.
  const { page, server } = await launch({ engine: { responder: () => reply, paceMs: 150 } });
  const ui = chat(page);

  await ui.send('Bonjour');

  await expect(ui.userMessages).toHaveCount(1);
  await expect(ui.userMessages.first()).toContainText('Bonjour');
  // Its first words are shown, and the engine has not finished: the answer is
  // not held back and delivered whole. (Watching the text grow would prove
  // nothing: aparté reveals a text gradually even when it arrives at once.)
  await expect(ui.replyText).toContainText('Bonjour Paul');
  expect(server.finished).toBe(0);

  await expect(ui.replyText).toHaveText(reply, { timeout: 15_000 });
  await expect.poll(() => server.finished).toBe(1);
  await expect(ui.streamingReplies).toHaveCount(0);
  await expect(ui.errors).toHaveCount(0);
  // The composer is ready for the next message.
  await expect(ui.stopButton).toHaveCount(0);

  // The engine read the message, in the model's own template.
  expect(server.getSlotTokens(0).join('')).toContain('<|turn>user\nBonjour<turn|>');
});

test('what the model thinks after a tool is a block of its own, never added to the one before', async ({ launch }) => {
  const Q = '<|"|>';
  const answered = (prompt: string) => prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user');
  const { page, home } = await launch({
    engine: {
      responder: (prompt) =>
        answered(prompt)
          ? '<|channel>thought\nJe relis ce que j’ai lu.<channel|>Fini.'
          : `<|channel>thought\nJe lis d’abord.<channel|><|tool_call>call:read_file{path:${Q}notes.txt${Q}}<tool_call|>`,
    },
  });
  await writeFile(join(home, 'notes.txt'), 'une note\n');
  const ui = chat(page);
  await ui.send('Lis notes.txt');
  await expect(ui.replyText).toHaveText('Fini.', { timeout: 20_000 });
  const blocks = page.locator('aparte-chat-bubble[data-role="assistant"] .aparte-segment-thinking .aparte-thinking-content');
  await expect(blocks).toHaveCount(2);
  await expect(blocks.nth(0)).toHaveText('Je lis d’abord.');
  await expect(blocks.nth(1)).toHaveText('Je relis ce que j’ai lu.');
});

test('what the model thinks is kept apart from what it answers', async ({ launch }) => {
  const { page } = await launch({
    engine: { responder: () => '<|channel>thought\nIl me salue, je salue.<channel|>Bonjour Paul.' },
  });
  const ui = chat(page);

  await ui.send('Bonjour');

  await expect(ui.replyText).toHaveText('Bonjour Paul.');
  const thinking = page.locator('aparte-chat-bubble[data-role="assistant"] .aparte-segment-thinking');
  await expect(thinking).toHaveCount(1);
  // Folded by default, and still in the page for whoever opens it.
  await expect(thinking).not.toHaveAttribute('open');
  expect(await thinking.locator('.aparte-thinking-content').textContent()).toContain('Il me salue');
});
