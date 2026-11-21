/**
 * A turn of conversation reaches the core as one HTTP-shaped request, on
 * `bonaparte://app/agent/c/<conversation>`, and leaves as a stream of events:
 * aparté's server-loop wire, which its stock runner reads in the window.
 *
 * This phase serves text only: no tools, no journal, no KV memory yet. The
 * prompt is rendered from the messages of the request.
 */

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, type Core, type TurnEnd } from '../api.js';
import {
  FAKE_QWEN_TEMPLATE,
  startFakeLlamaServer,
  type FakeLlamaServer,
  type FakeLlamaServerOptions,
} from '../testing/fake-llama-server.js';
import { writeFakeGguf } from '../testing/fake-gguf.js';
import { AGENT_ENDPOINT, createAgentHandler } from './handler.js';
import { familyLayer } from '../families/index.js';

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
  const core = createCore({ dataDir, env: {} });
  return { server, core, handler: createAgentHandler(core) };
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

  it('answers 409, with a message a person can read, when no model is loaded — never loads one', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'bp-agent-'));
    const handler = createAgentHandler(createCore({ dataDir, env: {} }));
    const response = await handler(post(turn(user('Bonjour'))));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { message: expect.stringMatching(/no model is loaded/i) } });
  });

  it('answers 409 with what is wrong when the engine serves a model it cannot speak', async () => {
    const { handler } = await setup({ chatTemplate: '### {{ m }}' });
    const response = await handler(post(turn(user('Bonjour'))));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(/template/i);
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

  it('an answer the context cut off ends as such (length), never as finished', async () => {
    const { handler } = await setup({ responder: () => 'Une réponse coupée', truncate: true });
    const lines = await linesOf(await handler(post(turn(user('Bonjour')))));
    expect(lines.at(-1)).toMatchObject({ type: 'run-done', finishReason: 'length' });
  });

  it('a whole answer ends as finished (stop)', async () => {
    const { handler } = await setup({ responder: () => 'Bonjour Paul' });
    const lines = await linesOf(await handler(post(turn(user('Bonjour')))));
    expect(lines.at(-1)).toMatchObject({ type: 'run-done', finishReason: 'stop' });
  });

  it('sends reasoning as thinking-delta, apart from the answer', async () => {
    const { handler } = await setup({ responder: () => '<|channel>thought\nje compte<channel|>Bonjour' });
    const lines = await linesOf(await handler(post(turn(user('Bonjour')))));
    expect(joined(lines, 'thinking-delta')).toContain('je compte');
    expect(joined(lines, 'text-delta').trim()).toBe('Bonjour');
    expect(joined(lines, 'text-delta')).not.toContain('think');
  });

  it("sends the engine the whole conversation from its journal, in the template of the model's family (Gemma)", async () => {
    const prompts: string[] = [];
    const { handler } = await setup({
      responder: (prompt) => {
        prompts.push(prompt);
        return 'ok';
      },
    });
    await linesOf(await handler(post(turn(user('Bonjour')))));
    const messages = [
      user('Bonjour'),
      { role: 'assistant', content: 'ok' },
      user([{ type: 'text', text: 'Quel jour ' }, { type: 'text', text: 'sommes-nous ?' }]),
    ];
    await linesOf(await handler(post(turn(...messages))));
    expect(prompts).toHaveLength(2);
    expect(prompts[1]!.startsWith(prompts[0]!)).toBe(true);
    expect(prompts[1]).toContain('<|turn>user\nBonjour<turn|>\n');
    expect(prompts[1]).toContain('ok<turn|>\n');
    // A text file the window inlined arrives as a part of the message: it enters the message.
    expect(prompts[1]).toContain('<|turn>user\nQuel jour sommes-nous ?<turn|>\n');
    // A fake engine of 4 096 tokens: a small context, where a turn does not reason by default (audit I2).
    expect(prompts[1]!.endsWith(familyLayer('gemma').beginAssistant({ thinking: false }))).toBe(true);
  });

  it('speaks Qwen to a model whose template is Qwen', async () => {
    const prompts: string[] = [];
    const { handler } = await setup({
      chatTemplate: FAKE_QWEN_TEMPLATE,
      responder: (prompt) => {
        prompts.push(prompt);
        return 'ok';
      },
    });
    await linesOf(await handler(post(turn(user('Bonjour')))));
    expect(prompts[0]).toContain('<|im_start|>user\nBonjour<|im_end|>\n');
    expect(prompts[0]!.endsWith(familyLayer('qwen').beginAssistant({ thinking: false }))).toBe(true);
  });

  it("tells the engine where an answer ends in the model's family", async () => {
    const bodies: Record<string, unknown>[] = [];
    const { handler } = await setup({ onCompletion: (body) => bodies.push(body) });
    await linesOf(await handler(post(turn(user('Bonjour')))));
    expect(bodies[0]?.['stop']).toEqual(['<turn|>', '<|tool_response>']);
  });

  it('holds the engine for the turn, and lets it go when the turn ends, stopped or not', async () => {
    const { core: real } = await setup({ paceMs: 20, responder: () => 'un deux trois quatre cinq six' });
    let held = 0;
    let released = 0;
    const core = {
      ...real,
      hold: () => {
        held += 1;
        return () => (released += 1);
      },
    } as Core;
    const handler = createAgentHandler(core);
    await linesOf(await handler(post(turn(user('Bonjour')))));
    expect([held, released]).toEqual([1, 1]);

    const controller = new AbortController();
    const response = await handler(post(turn(user('Encore')), { signal: controller.signal }));
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    while (!(await reader.read()).done);
    await expect.poll(() => released).toBe(2);
    expect(held).toBe(2);
  });

  it('emits run-aborted then run-done and cuts the completion when the request is aborted', async () => {
    const { server, handler } = await setup({
      paceMs: 20,
      // Long enough that the stop always lands in the middle, however loaded the machine.
      responder: () => 'un deux trois quatre cinq six sept huit neuf dix '.repeat(30),
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
    await expect.poll(() => server.aborted, { timeout: 5_000 }).toBe(1);
  }, 20_000);

  it('cuts the completion when the request is aborted, though nothing holds the Request any more and the heap was collected', async () => {
    // A Request follows the signal it was made with only while it lives (undici: a WeakRef to its own controller).
    // Electron's protocol.handle and the smoke drop theirs once the handler answers: a collection in the middle of a
    // reply then left Stop unheard, and llama.cpp generated to the end (the real smoke, 2026-11-21).
    setFlagsFromString('--expose-gc');
    const collect = runInNewContext('gc') as () => void;
    const { server, handler } = await setup({
      paceMs: 20,
      responder: () => 'un deux trois quatre cinq six sept huit neuf dix '.repeat(30),
    });
    const controller = new AbortController();
    // Made and given away in one expression, as Electron does: only the handler may keep it.
    const response = await handler(post(turn(user('Compte')), { signal: controller.signal }));

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('text-delta')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    for (let pass = 0; pass < 3; pass += 1) {
      collect();
      await new Promise((resolve) => setTimeout(resolve, 10));
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
    // The engine hears it at its next chunk: it stops long before the reply's own end (some 6 s at this pace).
    await expect.poll(() => server.aborted, { timeout: 2_000 }).toBe(1);
  }, 20_000);

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
    // Its code, for the window to say it (task 12.3): never « unknown ».
    expect(lines.at(-1)!['code']).toBe('engine-died');
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

/** A request to another conversation of the same core. */
function postTo(id: string, body: unknown): Request {
  return new Request(`${AGENT_ENDPOINT}/c/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A core whose engine is managed: the fake binary launched with its slots folder, a KV memory on disk. */
async function managed() {
  const dataDir = await mkdtemp(join(tmpdir(), 'bp-agent-managed-'));
  const models = join(dataDir, 'models');
  await mkdir(models, { recursive: true });
  const model = join(models, 'gemma-4-test.gguf');
  await writeFakeGguf(model);
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const core = createCore({
    dataDir,
    env: {},
    llamaCommand: [process.execPath, fileURLToPath(new URL('../testing/fake-llama-bin.mjs', import.meta.url))],
    port,
    modelRoots: [{ dir: models, source: 'custom' }],
    gpuMemory: async () => 24 * 1024 ** 3,
    llamaReleases: null,
    logger: () => undefined,
  });
  managedCores.push(core);
  await core.loadModel(model);
  return { core, dataDir, handler: createAgentHandler(core) };
}

const managedCores: Core[] = [];
afterEach(async () => {
  await Promise.all(managedCores.splice(0).map((core) => core.stop()));
});

describe('the agent handler, on the journal', () => {
  it('answers 409 to a history that is not this conversation’s', async () => {
    const { handler } = await setup();
    await linesOf(await handler(post(turn(user('Bonjour')))));
    const response = await handler(post(turn(user('Autre'), { role: 'assistant', content: 'x' }, user('Encore'))));
    expect(response.status).toBe(409);
  });

  it('refuses an image before anything runs, and says why', async () => {
    const { handler } = await setup();
    const response = await handler(post(turn(user([{ type: 'text', text: 'Regarde' }, { type: 'image', image: 'data:image/png;base64,AAAA' }]))));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(/reads no image/);
  });

  it('the last answer asked again: served by the cache up to the message, the usage says so', async () => {
    const { handler } = await setup({ responder: () => `réponse ${Math.random()}` });
    await linesOf(await handler(post(turn(user('Bonjour')))));
    const again = await linesOf(await handler(post(turn(user('Bonjour')))));
    const done = again.at(-1)!;
    expect(done.type).toBe('run-done');
    expect(done['usage'].inputTokens - done['usage'].cacheReadTokens).toBeLessThan(10);
  });

  it('a conversation brought back from its memory says it, as a restore step', async () => {
    const { handler } = await managed();
    await linesOf(await handler(postTo('c1', turn(user('Bonjour')))));
    await linesOf(await handler(postTo('c2', turn(user('Salut')))));
    const lines = await linesOf(await handler(postTo('c1', turn(user('Bonjour'), { role: 'assistant', content: 'ok' }, user('Encore')))));
    expect(lines).toContainEqual({ type: 'step-start', name: 'restore' });
    expect(lines).toContainEqual({ type: 'step-end', name: 'restore' });
    expect(lines.at(-1)!['usage'].cacheReadTokens).toBeGreaterThan(30);
  });

  it('a memory let go is read again: a reread step, and its progress up to the whole', async () => {
    const { handler, dataDir } = await managed();
    await linesOf(await handler(postTo('c1', turn(user('Bonjour')))));
    await linesOf(await handler(postTo('c2', turn(user('Salut')))));
    for (const name of await readdir(join(dataDir, 'kv-slots'))) {
      if (name.startsWith('c1_main')) await rm(join(dataDir, 'kv-slots', name));
    }
    const lines = await linesOf(await handler(postTo('c1', turn(user('Bonjour'), { role: 'assistant', content: 'ok' }, user('Encore')))));
    const start = lines.findIndex((line) => line.type === 'step-start' && line['name'] === 'reread');
    const end = lines.findIndex((line) => line.type === 'step-end' && line['name'] === 'reread');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const progress = lines.slice(start, end).filter((line) => line.type === 'activity' && line['activityType'] === 'reread');
    expect(progress.length).toBeGreaterThan(0);
    const last = progress.at(-1)!['content'] as { done: number; total: number };
    expect(last.done).toBe(last.total);
  });
});

describe('the agent handler — the tools', () => {
  const Q = '<|"|>';
  const call = (text: string) => (prompt: string) =>
    prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user') ? 'Done.' : text;

  it('a call of the model runs, and the answer goes on: tool-start, its outcome, the text, then run-done', async () => {
    const { handler } = await setup({ responder: call(`<|tool_call>call:read_file{path:${Q}surely-not-here.txt${Q}}<tool_call|>`) });
    const lines = await linesOf(await handler(post(turn(user('Lis ce fichier')))));
    const kinds = lines.map((line) => line.type);
    expect(kinds).toContain('tool-start');
    expect(kinds.indexOf('tool-failed')).toBeGreaterThan(kinds.indexOf('tool-start'));
    expect(joined(lines, 'text-delta')).toContain('Done.');
    expect(lines.at(-1)?.type).toBe('run-done');
  });

  it('each call to the model begins a turn on the wire: what it thinks after a tool is a new block, never the last one', async () => {
    const { handler } = await setup({
      responder: (prompt) =>
        prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user')
          ? '<|channel>thought\nsecond<channel|>Done.'
          : `<|channel>thought\nfirst<channel|><|tool_call>call:read_file{path:${Q}surely-not-here.txt${Q}}<tool_call|>`,
    });
    const lines = await linesOf(await handler(post(turn(user('Lis ce fichier')))));
    const kinds = lines.map((line) => line.type);
    // One turn-start for the run's first model call, one for the call after the tool (aparté: a turn per model call).
    expect(kinds.filter((kind) => kind === 'turn-start')).toHaveLength(2);
    const second = kinds.lastIndexOf('turn-start');
    expect(second).toBeGreaterThan(kinds.indexOf('tool-failed'));
    const thoughtAfter = lines.findIndex((line, at) => at > second && line.type === 'thinking-delta');
    expect(thoughtAfter).toBeGreaterThan(second);
    expect(joined(lines.slice(second), 'thinking-delta')).toContain('second');
    expect(joined(lines.slice(second), 'thinking-delta')).not.toContain('first');
  });

  it('the text of a round is flushed before the next turn begins, and before the run ends: none of it stays held', async () => {
    const { handler } = await setup({
      responder: (prompt) =>
        prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user')
          ? 'La valeur est `42`'
          : `Je lis \`a.ts\`<|tool_call>call:read_file{path:${Q}surely-not-here.txt${Q}}<tool_call|>`,
    });
    const lines = await linesOf(await handler(post(turn(user('Lis ce fichier')))));
    const kinds = lines.map((line) => line.type);
    // aparté's parser holds a text that ends on a backtick until more comes: a turn-start without a flush drops it.
    const second = kinds.lastIndexOf('turn-start');
    expect(kinds.slice(0, second)).toContain('text-flush');
    expect(kinds.lastIndexOf('text-flush')).toBeGreaterThan(kinds.lastIndexOf('text-delta'));
    expect(kinds.lastIndexOf('text-flush')).toBeLessThan(kinds.indexOf('run-done'));
  });

  it('a call to ask about ends the stream with run-suspended: its pending call, and a ticket', async () => {
    const { handler } = await setup({
      responder: call(`<|tool_call>call:edit_file{path:${Q}a.ts${Q},old_string:${Q}a${Q},new_string:${Q}b${Q}}<tool_call|>`),
    });
    const lines = await linesOf(await handler(post(turn(user('Change a.ts')))));
    expect(lines.map((line) => line.type)).toContain('tool-awaiting-approval');
    const last = lines.at(-1)!;
    expect(last).toMatchObject({ type: 'run-suspended', pending: [{ name: 'edit_file', reason: 'approval' }] });
    expect(typeof last['ticket']).toBe('string');
  });
});

describe('the agent handler — the end of a turn, told to whoever listens (task 8.5: the notifications)', () => {
  const Q = '<|"|>';
  const call = (text: string) => (prompt: string) =>
    prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user') ? 'Done.' : text;
  const ASK_USER = { name: 'ask_user', description: 'Ask the person.', inputSchema: { type: 'object', properties: { question: { type: 'string' } } } };

  async function listened(options: FakeLlamaServerOptions) {
    const made = await setup(options);
    const ends: TurnEnd[] = [];
    made.core.onTurnEnd((end) => ends.push(end));
    return { ...made, ends };
  }

  it('a reply that ends: its conversation, its title, and its first words', async () => {
    const { handler, ends } = await listened({ responder: () => 'Bonjour Paul, le récap est exporté.' });
    await linesOf(await handler(post(turn(user('Exporte le récap')))));
    expect(ends).toEqual([{ conversationId: 'c1', title: expect.any(String), how: 'done', said: 'Bonjour Paul, le récap est exporté.' }]);
  });

  it('a call that waits for the person: the call, as the approval card shows it', async () => {
    const { handler, ends } = await listened({
      responder: call(`<|tool_call>call:edit_file{path:${Q}src/format.ts${Q},old_string:${Q}a${Q},new_string:${Q}b${Q}}<tool_call|>`),
    });
    await linesOf(await handler(post(turn(user('Corrige les heures')))));
    expect(ends).toEqual([
      {
        conversationId: 'c1',
        title: expect.any(String),
        how: 'approval',
        call: { name: 'edit_file', input: { path: 'src/format.ts', old_string: 'a', new_string: 'b' } },
      },
    ]);
  });

  it('a question of the model: its words', async () => {
    const { handler, ends } = await listened({ responder: call(`<|tool_call>call:ask_user{question:${Q}Une date vide : je la garde ?${Q}}<tool_call|>`) });
    await linesOf(await handler(post({ ...turn(user('Valide le formulaire')), clientTools: [ASK_USER] })));
    expect(ends).toEqual([{ conversationId: 'c1', title: expect.any(String), how: 'question', question: 'Une date vide : je la garde ?' }]);
  });

  it('an engine that fails in the middle of the answer: a failure', async () => {
    const { handler, ends } = await listened({ responder: () => 'un deux trois quatre', failAfter: 2 });
    await linesOf(await handler(post(turn(user('Compte')))));
    expect(ends).toEqual([{ conversationId: 'c1', title: expect.any(String), how: 'failed' }]);
  });

  it('a reply the person stopped: nothing to tell them', async () => {
    const { handler, ends } = await listened({ paceMs: 20, responder: () => 'un deux trois quatre cinq six sept huit '.repeat(20) });
    const controller = new AbortController();
    const response = await handler(post(turn(user('Compte')), { signal: controller.signal }));
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    while (!(await reader.read()).done);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ends).toEqual([]);
  });
});

describe('the agent handler — the mode of a new conversation', () => {
  const at = (path: string, body: unknown) =>
    new Request(`${AGENT_ENDPOINT}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('a conversation the first turn creates runs in the mode the window chose before it existed', async () => {
    const { core, handler } = await setup({ responder: () => 'ok' });
    await (await handler(at('/c/fresh?mode=lecture', turn(user('Bonjour'))))).text();
    expect((await core.conversationStore.get('fresh'))?.mode).toBe('lecture');
  });

  it('a conversation the page saved before its first turn (made in the default mode) takes the mode of that turn', async () => {
    const { core, handler } = await setup({ responder: () => 'ok' });
    await core.conversationStore.ensure('saved', { kind: 'code', engineId: 'builtin', modelId: '', mode: 'repetition' });
    await (await handler(at('/c/saved?mode=lecture', turn(user('Bonjour'))))).text();
    expect((await core.conversationStore.get('saved'))?.mode).toBe('lecture');
  });

  it('after its first turn, the mode of a conversation is the core’s: a turn never changes it', async () => {
    const { core, handler } = await setup({ responder: () => 'ok' });
    await (await handler(at('/c/kept?mode=plume', turn(user('Bonjour'))))).text();
    const second = { ...turn(user('Bonjour'), { role: 'assistant', content: 'ok' }, user('Encore')), messageId: 'm2' };
    await (await handler(at('/c/kept?mode=impro', second))).text();
    expect((await core.conversationStore.get('kept'))?.mode).toBe('plume');
  });

  it('a mode that is not one is not taken: the new conversation asks before every change', async () => {
    const { core, handler } = await setup({ responder: () => 'ok' });
    await (await handler(at('/c/odd?mode=root', turn(user('Bonjour'))))).text();
    expect((await core.conversationStore.get('odd'))?.mode).toBe('repetition');
  });

  it('Impro chosen for a new conversation is the person’s choice of now: nothing to confirm again', async () => {
    const { core, handler } = await setup({ responder: () => 'ok' });
    await (await handler(at('/c/bold?mode=impro&picked=1', turn(user('Bonjour'))))).text();
    expect(await core.modeOf('bold')).toEqual({ mode: 'impro', reconfirm: false });
  });

  it('Impro as a default — the settings’ or a project’s, read from disk — is no confirmation (security rule 9)', async () => {
    const { core, handler } = await setup({ responder: () => 'ok' });
    await (await handler(at('/c/defaulted?mode=impro', turn(user('Bonjour'))))).text();
    expect(await core.modeOf('defaulted')).toEqual({ mode: 'plume', reconfirm: true });
    const folder = await mkdtemp(join(tmpdir(), 'bp-handler-impro-'));
    const project = await core.projects.create({ name: 'p', roots: [folder], defaultMode: 'impro' });
    await (await handler(at(`/c/projected?project=${project.id}`, turn(user('Bonjour'))))).text();
    expect(await core.modeOf('projected')).toEqual({ mode: 'plume', reconfirm: true });
  });

  it("a conversation started in a project belongs to it, runs in its default mode, and reads its instructions", async () => {
    const prompts: string[] = [];
    const { core, handler } = await setup({ responder: () => 'ok', onCompletion: (body) => prompts.push(String(body['prompt'])) });
    const folder = await mkdtemp(join(tmpdir(), 'bp-handler-project-'));
    await writeFile(join(folder, 'AGENTS.md'), 'Always answer with tabs.\n');
    const project = await core.projects.create({ name: 'p', roots: [folder], defaultMode: 'plume' });
    await (await handler(at(`/c/in-project?project=${project.id}`, turn(user('Bonjour'))))).text();
    expect(await core.conversationStore.get('in-project')).toMatchObject({ projectId: project.id, mode: 'plume' });
    expect(prompts.find((prompt) => prompt.includes('Bonjour'))).toContain('Always answer with tabs.');
    // The mode the person chose before the first message comes before the project's.
    await (await handler(at(`/c/chosen?project=${project.id}&mode=lecture`, turn(user('Bonjour'))))).text();
    expect((await core.conversationStore.get('chosen'))?.mode).toBe('lecture');
    // A project that does not exist is no project.
    await (await handler(at('/c/nowhere?project=ghost', turn(user('Bonjour'))))).text();
    expect((await core.conversationStore.get('nowhere'))?.projectId).toBeUndefined();
  });

  it('« Rechercher » finds a conversation as soon as its turn ends, and the files of its project', async () => {
    const { core, handler } = await setup({ responder: () => 'Le fuseau horaire est Europe/Paris.' });
    const folder = await mkdtemp(join(tmpdir(), 'bp-handler-search-'));
    await mkdir(join(folder, 'src'), { recursive: true });
    await writeFile(join(folder, 'src', 'timezone.ts'), '');
    const project = await core.projects.create({ name: 'p', roots: [folder] });
    expect((await core.search('fuseau')).conversations).toEqual([]);
    await (await handler(at(`/c/zones?project=${project.id}`, turn(user('Quel fuseau ?'))))).text();
    const found = await core.search('fuseau', { conversationId: 'zones' });
    expect(found.conversations.map((one) => one.id)).toEqual(['zones']);
    expect((await core.search('timezone', { conversationId: 'zones' })).files).toEqual([{ path: 'src/timezone.ts' }]);
  });
});

