import { afterEach, describe, expect, it } from 'vitest';
import {
  startFakeLlamaServer,
  type FakeLlamaServer,
} from '../../testing/fake-llama-server.js';
import type { CompletionEvent, CompletionStats } from '../types.js';
import { LlamaCppHttpClient, LlamaCppHttpError } from './http-client.js';

let servers: FakeLlamaServer[] = [];

async function startServer(
  ...args: Parameters<typeof startFakeLlamaServer>
): Promise<{ server: FakeLlamaServer; client: LlamaCppHttpClient }> {
  const server = await startFakeLlamaServer(...args);
  servers.push(server);
  return { server, client: new LlamaCppHttpClient(server.url) };
}

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

async function collect(
  events: AsyncIterable<CompletionEvent>,
): Promise<{ text: string; stats: CompletionStats }> {
  let text = '';
  let stats: CompletionStats | null = null;
  for await (const event of events) {
    if (event.type === 'token') text += event.text;
    else if (event.type === 'done') stats = event.stats;
  }
  if (!stats) throw new Error('no "done" event');
  return { text, stats };
}

describe('LlamaCppHttpClient', () => {
  it('health() reflects server availability', async () => {
    const { client } = await startServer();
    expect(await client.health()).toBe(true);
    const down = new LlamaCppHttpClient('http://127.0.0.1:1');
    expect(await down.health()).toBe(false);
  });

  it('props() surfaces modelPath and totalSlots', async () => {
    const { client } = await startServer({
      modelPath: 'D:\\models\\qwen3.gguf',
      totalSlots: 4,
    });
    const props = await client.props();
    expect(props.modelPath).toBe('D:\\models\\qwen3.gguf');
    expect(props.totalSlots).toBe(4);
  });

  it('props() surfaces the context one slot really has: -c is shared between the slots', async () => {
    const { client } = await startServer({ nCtx: 8192, totalSlots: 2 });
    expect((await client.props()).nCtx).toBe(4096);
    const { client: one } = await startServer({ nCtx: 8192 });
    expect((await one.props()).nCtx).toBe(8192);
  });

  it('complete() streams the tokens then the final stats', async () => {
    const { client } = await startServer({
      responder: () => 'bonjour le monde',
      msPerToken: 5,
    });
    const { text, stats } = await collect(
      client.complete({ prompt: 'x'.repeat(20) }),
    );
    expect(text).toBe('bonjour le monde');
    expect(stats.promptMs).toBe(25); // 5 tokens × 5 ms
    expect(stats.predictedTokens).toBeGreaterThan(0);
  });

  it('complete() targets a slot and benefits from its cache', async () => {
    const { client } = await startServer({ msPerToken: 10, responder: () => '' });
    const prefix = 'x'.repeat(40);
    const first = await collect(client.complete({ prompt: prefix, idSlot: 0 }));
    expect(first.stats.promptMs).toBe(100);
    const second = await collect(
      client.complete({ prompt: prefix + 'y'.repeat(8), idSlot: 0 }),
    );
    expect(second.stats.promptMs).toBe(20);
  });

  it('complete() surfaces prompt_progress when requested', async () => {
    const { client } = await startServer({ responder: () => '' });
    const prefix = 'x'.repeat(40);
    await collect(client.complete({ prompt: prefix, idSlot: 0 }));
    const { stats } = await collect(
      client.complete({
        prompt: prefix + 'y'.repeat(8),
        idSlot: 0,
        returnProgress: true,
      }),
    );
    expect(stats.progress).toEqual({
      total: 12,
      cache: 10,
      processed: 12,
      timeMs: stats.promptMs,
    });
  });

  it('complete() yields the prefill progress as it goes — a long prompt is not a silent wait (P2.8)', async () => {
    const { client } = await startServer({ responder: () => 'ok', prefillBatch: 4 });
    const progress: { processed: number; total: number; cache: number; timeMs: number }[] = [];
    for await (const event of client.complete({ prompt: 'x'.repeat(40), idSlot: 0, returnProgress: true })) {
      if (event.type === 'progress') progress.push(event.progress);
    }
    // One step per batch of 4, from nothing processed to the whole prompt.
    expect(progress.map((step) => step.processed)).toEqual([0, 4, 8, 10]);
    expect(progress.every((step) => step.total === 10 && step.cache === 0)).toBe(true);
    expect(progress.at(-1)?.timeMs).toBeGreaterThan(0);
  });

  it('complete() reports the cached prompt tokens even without return_progress', async () => {
    // The real server never puts `prompt_progress` on its final event; the
    // count that makes the context gauge honest is `timings.cache_n`. Read
    // only from the final event, the progress was always missing — and the
    // gauge showed zero cached tokens on every real turn (seen on
    // 2026-08-28: 821 tokens served from the cache, reported as 0).
    const { client } = await startServer({ responder: () => '' });
    const prefix = 'x'.repeat(40);
    await collect(client.complete({ prompt: prefix, idSlot: 0 }));
    const { stats } = await collect(
      client.complete({ prompt: prefix + 'y'.repeat(8), idSlot: 0 }),
    );
    expect(stats.progress?.cache).toBe(10);
    expect(stats.progress?.total).toBe(12);
    expect(stats.promptUncachedTokens).toBe(2);
  });

  it('saveSlot/restoreSlot complete the full cycle across a restart', async () => {
    const disk = new Map();
    const { server, client } = await startServer({
      files: disk,
      msPerToken: 10,
      responder: () => '',
    });
    const prompt = 'x'.repeat(400);
    await collect(client.complete({ prompt, idSlot: 0 }));

    const saved = await client.saveSlot(0, 'conv-42.slot');
    expect(saved).toMatchObject({ idSlot: 0, filename: 'conv-42.slot', nSaved: 100 });
    expect(saved.nWritten).toBeGreaterThan(0);
    await server.close();

    const { client: client2 } = await startServer({
      files: disk,
      msPerToken: 10,
      responder: () => '',
    });
    const restored = await client2.restoreSlot(0, 'conv-42.slot');
    expect(restored).toMatchObject({ idSlot: 0, nRestored: 100 });

    const { stats } = await collect(
      client2.complete({ prompt: prompt + 'y'.repeat(8), idSlot: 0 }),
    );
    expect(stats.promptMs).toBe(20);
  });

  it('eraseSlot returns the number of erased tokens', async () => {
    const { client } = await startServer({ responder: () => '' });
    await collect(client.complete({ prompt: 'x'.repeat(40), idSlot: 0 }));
    expect(await client.eraseSlot(0)).toBe(10);
  });

  it('restoreSlot throws LlamaCppHttpError(400) for an unknown file', async () => {
    const { client } = await startServer();
    await expect(client.restoreSlot(0, 'inconnu.slot')).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlamaCppHttpError && err.status === 400,
    );
  });

  it('complete() rejects immediately if the signal is already aborted', async () => {
    const { client } = await startServer();
    const controller = new AbortController();
    controller.abort();
    await expect(
      collect(client.complete({ prompt: 'x', signal: controller.signal })),
    ).rejects.toThrow();
  });

  it('complete() throws the failure the server reports in the middle of a stream', async () => {
    // llama-server sends it as an event of the stream (`data: {"error": …}`),
    // then ends the stream: tools/server/server-context.cpp.
    const { client } = await startServer({ responder: () => 'one two three four', failAfter: 2 });
    let text = '';
    const reading = (async () => {
      for await (const event of client.complete({ prompt: 'hello' })) {
        if (event.type === 'token') text += event.text;
      }
    })();
    await expect(reading).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlamaCppHttpError && err.status === 500 && err.message.includes('failed to decode'),
    );
    // What was generated before the failure was delivered first.
    expect(text).toBe('one two ');
  });

  it('applyTemplate() asks the server to render messages with its own template, and gives the prompt', async () => {
    const { client } = await startServer();
    const prompt = await client.applyTemplate([{ role: 'user', content: 'Bonjour' }], { enable_thinking: false });
    expect(prompt).toBe('<bos><|turn>user\nBonjour<turn|>\n<|turn>model\n');
  });

  it('slots() says which slots are generating, and stop saying it once the stream is cut', async () => {
    const { server, client } = await startServer({ totalSlots: 2, paceMs: 20, responder: () => 'one '.repeat(200) });
    expect(await client.slots()).toEqual([
      { id: 0, processing: false },
      { id: 1, processing: false },
    ]);

    const controller = new AbortController();
    const stream = client.complete({ prompt: 'count', idSlot: 1, signal: controller.signal })[Symbol.asyncIterator]();
    await stream.next();
    expect(await client.slots()).toEqual([
      { id: 0, processing: false },
      { id: 1, processing: true },
    ]);

    controller.abort();
    await stream.next().catch(() => undefined);
    await expect.poll(async () => (await client.slots())[1]?.processing).toBe(false);
    expect(server.aborted).toBe(1);
  });
});
