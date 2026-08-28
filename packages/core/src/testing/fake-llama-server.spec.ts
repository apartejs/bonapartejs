import { afterEach, describe, expect, it } from 'vitest';
import {
  fakeTokenize,
  startFakeLlamaServer,
  type FakeLlamaServer,
} from './fake-llama-server.js';

let servers: FakeLlamaServer[] = [];

async function start(
  ...args: Parameters<typeof startFakeLlamaServer>
): Promise<FakeLlamaServer> {
  const server = await startFakeLlamaServer(...args);
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

/** POST /completion as a stream and aggregates the SSE data: {...} events. */
async function complete(
  server: FakeLlamaServer,
  body: Record<string, unknown>,
): Promise<{ content: string; final: Record<string, any> }> {
  const res = await fetch(`${server.url}/completion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stream: true, ...body }),
  });
  expect(res.ok).toBe(true);
  const text = await res.text();
  const events = text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)));
  const final = events.at(-1);
  if (!final?.stop) throw new Error('last event has no stop:true');
  return {
    content: events.map((e) => e.content ?? '').join(''),
    final,
  };
}

async function slotAction(
  server: FakeLlamaServer,
  idSlot: number,
  action: string,
  filename?: string,
): Promise<{ status: number; body: Record<string, any> }> {
  const res = await fetch(`${server.url}/slots/${idSlot}?action=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: filename ? JSON.stringify({ filename }) : '{}',
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('fake llama-server', () => {
  it('responds ok on /health', async () => {
    const server = await start();
    const res = await fetch(`${server.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('exposes model_path and total_slots on /props', async () => {
    const server = await start({ modelPath: 'D:\\models\\qwen.gguf', totalSlots: 2 });
    const res = await fetch(`${server.url}/props`);
    const props = (await res.json()) as Record<string, any>;
    expect(props['model_path']).toBe('D:\\models\\qwen.gguf');
    expect(props['total_slots']).toBe(2);
  });

  it('streams the response over SSE and ends with stop:true', async () => {
    const server = await start({ responder: () => 'bonjour de bonaparte' });
    const { content, final } = await complete(server, { prompt: 'salut' });
    expect(content).toBe('bonjour de bonaparte');
    expect(final['stop']).toBe(true);
    expect(final['timings']).toBeDefined();
  });

  it('bills the prefill proportionally to uncached tokens (first call = all of it)', async () => {
    const server = await start({ msPerToken: 10 });
    const prompt = 'x'.repeat(40); // 10 tokens of 4 chars
    const { final } = await complete(server, { prompt });
    expect(final['timings']['prompt_ms']).toBe(100);
  });

  it('reuses the slot cache: an already-seen prefix is not paid for again', async () => {
    const server = await start({ msPerToken: 10 });
    const prefix = 'x'.repeat(40);
    await complete(server, { prompt: prefix, id_slot: 0 });
    const { final } = await complete(server, {
      prompt: prefix + 'y'.repeat(8), // +2 tokens
      id_slot: 0,
    });
    expect(final['timings']['prompt_ms']).toBe(20);
  });

  it('reports prompt_progress when return_progress is requested', async () => {
    const server = await start();
    const prefix = 'x'.repeat(40);
    await complete(server, { prompt: prefix, id_slot: 0 });
    const { final } = await complete(server, {
      prompt: prefix + 'y'.repeat(8),
      id_slot: 0,
      return_progress: true,
    });
    const progress = final['prompt_progress'];
    expect(progress['total']).toBe(12);
    expect(progress['cache']).toBe(10);
    expect(progress['processed']).toBe(12);
  });

  it('saves the slot cache to a named file (n_saved, n_written)', async () => {
    // empty responder: the slot cache = the prompt's tokens only (the real
    // server keeps prompt + generation; here we pin the count).
    const server = await start({ responder: () => '' });
    const prompt = 'x'.repeat(40);
    await complete(server, { prompt, id_slot: 0 });
    const { status, body } = await slotAction(server, 0, 'save', 'conv-1.slot');
    expect(status).toBe(200);
    expect(body['id_slot']).toBe(0);
    expect(body['filename']).toBe('conv-1.slot');
    expect(body['n_saved']).toBe(fakeTokenize(prompt).length);
    expect(body['n_written']).toBeGreaterThan(0);
    expect(server.files.has('conv-1.slot')).toBe(true);
  });

  it('restores a saved state after a "restart" (same files, new process)', async () => {
    const disk = new Map();
    const first = await start({ msPerToken: 10, files: disk, responder: () => '' });
    const prompt = 'x'.repeat(400); // 100 tokens
    await complete(first, { prompt, id_slot: 0 });
    await slotAction(first, 0, 'save', 'conv-1.slot');
    await first.close();

    const second = await start({ msPerToken: 10, files: disk, responder: () => '' });
    const restore = await slotAction(second, 0, 'restore', 'conv-1.slot');
    expect(restore.status).toBe(200);
    expect(restore.body['n_restored']).toBe(100);

    const { final } = await complete(second, {
      prompt: prompt + 'y'.repeat(8),
      id_slot: 0,
    });
    expect(final['timings']['prompt_ms']).toBe(20); // only 2 tokens
  });

  it('erase empties the slot cache (n_erased) and the prefill is paid again', async () => {
    const server = await start({ msPerToken: 10, responder: () => '' });
    const prompt = 'x'.repeat(40);
    await complete(server, { prompt, id_slot: 0 });
    const { body } = await slotAction(server, 0, 'erase');
    expect(body['n_erased']).toBe(10);
    const { final } = await complete(server, { prompt, id_slot: 0 });
    expect(final['timings']['prompt_ms']).toBe(100);
  });

  it('responds 400 when the file to restore is unknown', async () => {
    const server = await start();
    const { status } = await slotAction(server, 0, 'restore', 'inconnu.slot');
    expect(status).toBe(400);
  });

  it('distinct slots have independent caches', async () => {
    const server = await start({ msPerToken: 10, totalSlots: 2 });
    const prompt = 'x'.repeat(40);
    await complete(server, { prompt, id_slot: 0 });
    const { final } = await complete(server, { prompt, id_slot: 1 });
    expect(final['timings']['prompt_ms']).toBe(100); // slot 1 has nothing cached
  });

  it('GET /slots reflects the state of the slots', async () => {
    const server = await start({ totalSlots: 2 });
    await complete(server, { prompt: 'x'.repeat(16), id_slot: 1 });
    const res = await fetch(`${server.url}/slots`);
    const slots = (await res.json()) as Array<Record<string, any>>;
    expect(slots).toHaveLength(2);
    expect(slots[1]?.['n_ctx_used']).toBeGreaterThan(0);
  });
});
