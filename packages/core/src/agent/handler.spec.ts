/**
 * A turn of conversation reaches the core as one HTTP-shaped request, on
 * `bonaparte://app/agent/c/<conversation>`, and leaves as a stream of events:
 * aparté's server-loop wire, which its stock runner reads in the window.
 *
 * This phase serves text only: no tools, no journal, no KV memory yet. The
 * prompt is rendered from the messages of the request.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore } from '../api.js';
import {
  startFakeLlamaServer,
  type FakeLlamaServer,
  type FakeLlamaServerOptions,
} from '../testing/fake-llama-server.js';
import { AGENT_ENDPOINT, createAgentHandler } from './handler.js';

let servers: FakeLlamaServer[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
});

/** A core whose engine is a fake llama-server, as a remote one would be configured. */
async function setup(options: FakeLlamaServerOptions = {}) {
  const server = await startFakeLlamaServer(options);
  servers.push(server);
  const dataDir = await mkdtemp(join(tmpdir(), 'bp-agent-'));
  await mkdir(join(dataDir, 'config'), { recursive: true });
  await writeFile(
    join(dataDir, 'config', 'global.json'),
    JSON.stringify({ backend: { mode: 'remote', url: server.url } }),
  );
  return { server, handler: createAgentHandler(createCore({ dataDir, env: {} })) };
}

const conversation = `${AGENT_ENDPOINT}/c/c1`;

function post(body: unknown, init: RequestInit = {}): Request {
  return new Request(conversation, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
}

function turn(...messages: { role: string; content: unknown }[]) {
  return { v: 1, messageId: 'm1', request: { messages, modelId: '' }, clientTools: [] };
}

const user = (content: unknown) => ({ role: 'user', content });

type Line = { type: string } & Record<string, any>;

async function linesOf(response: Response): Promise<Line[]> {
  const text = await response.text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Line);
}

const joined = (lines: Line[], type: string) =>
  lines
    .filter((line) => line.type === type)
    .map((line) => line['delta'] as string)
    .join('');

describe('the agent handler, before the stream', () => {
  it('answers 415 when the body is not JSON', async () => {
    const { handler } = await setup();
    const response = await handler(
      new Request(conversation, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hello' }),
    );
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: { message: expect.any(String) } });
  });

  it('answers 400 when the JSON cannot be read', async () => {
    const { handler } = await setup();
    const response = await handler(post('{ nope'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { message: expect.any(String) } });
  });

  it('answers 400 with { error: { message } } when v is not 1', async () => {
    const { handler } = await setup();
    const response = await handler(post({ ...turn(user('Bonjour')), v: 2 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { message: expect.stringContaining('v') } });
  });

  it('answers 400 when the request has no messages', async () => {
    const { handler } = await setup();
    const response = await handler(post({ v: 1, messageId: 'm1', request: {}, clientTools: [] }));
    expect(response.status).toBe(400);
  });

  it('answers 405 to anything but a POST, and 404 outside a conversation', async () => {
    const { handler } = await setup();
    expect((await handler(new Request(conversation))).status).toBe(405);
    expect((await handler(post(turn(user('Bonjour')), {}).clone())).status).toBe(200);
    const elsewhere = new Request(`${AGENT_ENDPOINT}/elsewhere`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(turn(user('Bonjour'))),
    });
    expect((await handler(elsewhere)).status).toBe(404);
  });

  it('answers 409, with a message a person can read, when no engine is configured', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'bp-agent-'));
    const handler = createAgentHandler(createCore({ dataDir, env: {} }));
    const response = await handler(post(turn(user('Bonjour'))));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { message: expect.stringMatching(/engine/i) } });
  });
});

describe('the agent handler, streaming a turn', () => {
  it('streams run-start, turn-start, text-delta and run-done', async () => {
    const { handler } = await setup({ responder: () => 'Bonjour Paul' });
    const response = await handler(post(turn(user('Bonjour'))));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');

    const lines = await linesOf(response);
    expect(lines.slice(0, 2).map((line) => line.type)).toEqual(['run-start', 'turn-start']);
    expect(joined(lines, 'text-delta')).toBe('Bonjour Paul');
    const last = lines.at(-1)!;
    expect(last.type).toBe('run-done');
    expect(last['usage'].inputTokens).toBeGreaterThan(0);
    expect(last['usage'].outputTokens).toBeGreaterThan(0);
  });

  it('sends reasoning as thinking-delta, apart from the answer', async () => {
    const { handler } = await setup({ responder: () => '<think>\nje compte\n</think>\n\nBonjour' });
    const lines = await linesOf(await handler(post(turn(user('Bonjour')))));
    expect(joined(lines, 'thinking-delta')).toContain('je compte');
    expect(joined(lines, 'text-delta').trim()).toBe('Bonjour');
    expect(joined(lines, 'text-delta')).not.toContain('think');
  });

  it('sends the engine the whole conversation, in the Qwen template', async () => {
    const prompts: string[] = [];
    const { handler } = await setup({
      responder: (prompt) => {
        prompts.push(prompt);
        return 'ok';
      },
    });
    const messages = [
      user('Bonjour'),
      { role: 'assistant', content: 'Bonjour Paul' },
      user([{ type: 'text', text: 'Quel jour ' }, { type: 'text', text: 'sommes-nous ?' }]),
    ];
    await linesOf(await handler(post(turn(...messages))));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('<|im_start|>user\nBonjour<|im_end|>\n');
    expect(prompts[0]).toContain('Bonjour Paul<|im_end|>\n');
    expect(prompts[0]).toContain('<|im_start|>user\nQuel jour sommes-nous ?<|im_end|>\n');
    expect(prompts[0]!.endsWith('<|im_start|>assistant\n')).toBe(true);
  });

  it('emits run-aborted then run-done and cuts the completion when the request is aborted', async () => {
    const { server, handler } = await setup({
      paceMs: 20,
      responder: () => 'un deux trois quatre cinq six sept huit neuf dix',
    });
    const controller = new AbortController();
    const response = await handler(post(turn(user('Compte')), { signal: controller.signal }));

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    // Wait until the answer has started to arrive, then stop.
    while (!text.includes('text-delta')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    controller.abort();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }

    const types = text
      .split('\n')
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as Line).type);
    expect(types.slice(-2)).toEqual(['run-aborted', 'run-done']);
    await expect.poll(() => server.aborted, { timeout: 2_000 }).toBe(1);
  });

  it('ends with run-error, and no run-done, when the engine fails once the stream began', async () => {
    // A context of four tokens: the engine refuses the prompt.
    const { handler } = await setup({ nCtx: 4 });
    const lines = await linesOf(await handler(post(turn(user('Bonjour, comment vas-tu ?')))));
    expect(lines.at(-1)!.type).toBe('run-error');
    expect(lines.at(-1)!['message']).toEqual(expect.any(String));
    expect(lines.map((line) => line.type)).not.toContain('run-done');
  });

  it('ends with run-error when the engine fails in the middle of its answer, after what it wrote', async () => {
    const { handler } = await setup({ responder: () => 'un deux trois quatre', failAfter: 2 });
    const lines = await linesOf(await handler(post(turn(user('Compte')))));
    expect(joined(lines, 'text-delta')).toBe('un deux ');
    expect(lines.at(-1)!.type).toBe('run-error');
    expect(lines.at(-1)!['message']).toContain('failed to decode');
    const types = lines.map((line) => line.type);
    expect(types).not.toContain('run-done');
    // A failure is not a stop: the window must not show it as one.
    expect(types).not.toContain('run-aborted');
  });

  it('ends with run-error, not with a stop, when the answer ends without its final event', async () => {
    const { handler } = await setup({ responder: () => 'un deux trois quatre', dropAfter: 2 });
    const lines = await linesOf(await handler(post(turn(user('Compte')))));
    expect(joined(lines, 'text-delta')).toBe('un deux ');
    expect(lines.at(-1)!.type).toBe('run-error');
    const types = lines.map((line) => line.type);
    expect(types).not.toContain('run-done');
    expect(types).not.toContain('run-aborted');
  });
});
