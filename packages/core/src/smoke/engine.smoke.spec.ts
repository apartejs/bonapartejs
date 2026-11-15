/**
 * REAL SMOKE — the built-in engine, on a real llama.cpp and a real model.
 *
 * Skipped unless `BONAPARTE_SMOKE_MODEL` names a GGUF: it never runs in CI.
 * It replays what the fake server cannot prove:
 *
 * 1. the managed server demands the per-launch key (the real one, not ours);
 * 2. the family's rendering is the model's own template, byte for byte — the
 *    template embedded in this GGUF, which may differ from the fixture the
 *    unit tests read (`/apply-template`; skipped, and said, if the route is
 *    missing);
 * 3. the lazy tool grammar is accepted by a real server, and does not force a
 *    call when none is needed;
 * 4. a real model writes a call in the family's syntax, and our demux reads it;
 * 5. Stop cuts a real generation: within a second the slot no longer works;
 * 6. a conversation that leaves the slot is saved, and comes back restored —
 *    no re-read, the saved tokens served by the cache, the model still knows
 *    what it was told;
 * 7. a branch (an answer asked again) starts from the state its conversation
 *    saved, not from what the slot held;
 * 8. the seed one fresh conversation prepared serves the next one.
 *
 * Everything goes through `createCore`, as the app does: the binary is found
 * on the PATH (or `BONAPARTE_SMOKE_LLAMA`), launched hidden with its key, and
 * checked against `/props`. One file, so that the model is loaded once.
 *
 *   $env:BONAPARTE_SMOKE_MODEL = "<path to a .gguf>"
 *   npx vitest run src/smoke
 *
 * Variables: BONAPARTE_SMOKE_MODEL (required) · BONAPARTE_SMOKE_LLAMA (the
 * llama.cpp binary, else found on the PATH) · BONAPARTE_SMOKE_CTX (8192).
 */

import { createAgentStreamRunner } from '@aparte/core';
import type { StreamRunEvent, StreamUsage } from '@aparte/engine';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_ENDPOINT, createAgentHandler } from '../agent/handler.js';
import { createCore, type Core, type Engine } from '../api.js';
import type { DemuxEvent } from '../families/types.js';
import { PromptLog } from '../prompt/prompt-log.js';
import { buildSystemPrompt } from '../prompt/system-prompt.js';
import type { Usage } from '../journal/types.js';
import type { ToolDef } from '../tools/types.js';

const MODEL = process.env['BONAPARTE_SMOKE_MODEL'];
const LLAMA = process.env['BONAPARTE_SMOKE_LLAMA'];
const N_CTX = Number(process.env['BONAPARTE_SMOKE_CTX'] ?? 8192);
const PORT = 8127;
/** A big model takes its time on a first load. */
const TIMEOUT = 900_000;
/** A small model at its default temperature is a coin flip on protocol details: the smoke judges the harness. */
const SAMPLING = { temperature: 0.2, seed: 42 };
/**
 * On a model with sliding-window attention (Gemma 4), llama.cpp resumes a
 * cached prefix from its last context checkpoint, which it places a few
 * tokens before the end of each prompt (tools/server/server-context.cpp,
 * « create checkpoints that many tokens before the end of the prompt »):
 * those few tokens are read again — 5 on b12383, a fixed cost, not a re-read.
 */
const CHECKPOINT_TAIL = 8;

const READ_FILE: ToolDef = {
  name: 'read_file',
  description: 'Read a text file of the project and return its content.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'The path of the file, relative to the project.' } },
    required: ['path'],
  },
  effect: 'read',
  source: 'builtin',
  where: 'core',
};

describe.skipIf(!MODEL)('REAL SMOKE — the built-in engine', () => {
  let dataDir: string;
  let home: string;
  let core: Core;
  let engine: Engine;

  /** One answer under the lazy tool grammar, read by the family's demux. */
  async function answer(user: string, tools: readonly ToolDef[]): Promise<{ text: string; events: DemuxEvent[] }> {
    // The system prompt the app sends: its two turns, the tools in the first.
    const system = buildSystemPrompt({ kind: 'code', family: engine.family, tools, perimeter: [], replyLanguage: 'English' });
    const log = new PromptLog(engine.family);
    log.appendSystem(system.stable);
    log.appendSystemNote(system.project);
    log.appendUser(user);
    const prompt = log.beginAssistantTurn({ thinking: false });
    const demux = engine.family.createDemux();
    const events: DemuxEvent[] = [];
    for await (const event of engine.client.complete({
      prompt,
      ...engine.family.toolGrammar(tools)!,
      nPredict: 400,
      sampling: { ...SAMPLING, stop: [...engine.family.stop] },
    })) {
      if (event.type === 'token') events.push(...demux.push(event.text));
    }
    events.push(...demux.flush());
    const text = events
      .filter((event): event is Extract<DemuxEvent, { type: 'text' }> => event.type === 'text')
      .map((event) => event.delta)
      .join('');
    return { text, events };
  }

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-smoke-'));
    await mkdir(join(dataDir, 'config'), { recursive: true });
    await writeFile(join(dataDir, 'config', 'global.json'), JSON.stringify({ engine: { nCtx: N_CTX } }));
    // The tools' folder: the smoke's own, never the person's.
    home = join(dataDir, 'home');
    await mkdir(home, { recursive: true });
    core = createCore({
      dataDir,
      home,
      port: PORT,
      modelRoots: [{ dir: dirname(MODEL!), source: 'manual' }],
      env: { ...process.env, ...(LLAMA ? { BONAPARTE_LLAMA_BIN: LLAMA } : {}) },
      // Only what matters: the rest of llama.cpp's log would drown the verdict.
      logger: (line) => {
        if (/error|failed|invalid|unknown argument/i.test(line)) console.log(`[llama] ${line}`);
      },
    });
    const started = Date.now();
    const state = await core.loadModel(MODEL!);
    engine = (await core.engine())!;
    console.log(
      `[smoke] ${state.model?.name} · family ${state.model?.family} · n_ctx ${state.model?.nCtx} · loaded in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
  }, TIMEOUT);

  afterAll(async () => {
    await core?.stop();
    if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  }, 60_000);

  it('the real server refuses a request without our key', async () => {
    const bare = await fetch(`http://127.0.0.1:${PORT}/props`);
    console.log(`[smoke] /props without the key: HTTP ${bare.status}`);
    expect(bare.status).toBe(401);
    await expect(engine.client.props()).resolves.toMatchObject({ modelPath: expect.any(String) });
  });

  it("renders a turn exactly as the model's own template does", async (context) => {
    const messages = [
      { role: 'system', content: 'You are bonaparte.' },
      { role: 'user', content: 'Bonjour' },
    ];
    const template = async (thinking: boolean): Promise<string | null> => {
      try {
        // The server adds the BOS token itself when it tokenizes a /completion prompt: ours has none.
        return (await engine.client.applyTemplate(messages, { enable_thinking: thinking })).replace(/^<bos>/, '');
      } catch (error) {
        console.log(`[smoke] /apply-template is not available: ${String(error)}`);
        return null;
      }
    };
    const ours = (thinking: boolean): string => {
      const log = new PromptLog(engine.family);
      log.appendSystem('You are bonaparte.');
      log.appendUser('Bonjour');
      return log.beginAssistantTurn({ thinking });
    };

    const reasoning = await template(true);
    if (reasoning === null) {
      context.skip();
      return;
    }
    // A conversation reasons — switched on once, in its frozen system turn —: the whole prompt is the template's.
    expect(ours(true)).toBe(reasoning);
    // A turn that should not reason opens as the template opens one. (The template, told
    // not to reason, also leaves the switch out of the system turn: a frozen prompt cannot.)
    const opening = engine.family.beginAssistant({ thinking: false });
    expect((await template(false))!.endsWith(opening)).toBe(true);
    expect(ours(false).endsWith(opening)).toBe(true);
  });

  it('a simple question under the lazy tool grammar: no call is forced', async () => {
    const out = await answer('What is 2 + 2? Answer with the number only.', [READ_FILE]);
    const calls = out.events.filter((event) => event.type === 'tool-call' || event.type === 'tool-call-malformed');
    console.log(`[smoke] answer: ${JSON.stringify(out.text.trim().slice(0, 80))} · calls: ${calls.length}`);
    expect(calls).toEqual([]);
    expect(out.text).toContain('4');
  }, TIMEOUT);

  it("a real model writes a call in its family's syntax, and the demux reads it", async () => {
    // The tool is named on purpose: the smoke judges the harness, not the model's initiative.
    const out = await answer('Use the read_file tool to read the file notes.txt.', [READ_FILE]);
    const calls = out.events.filter((event) => event.type === 'tool-call' || event.type === 'tool-call-malformed');
    console.log(`[smoke] calls: ${JSON.stringify(calls)}`);
    expect(calls).toEqual([{ type: 'tool-call', name: 'read_file', input: { path: 'notes.txt' } }]);
  }, TIMEOUT);

  it('Stop cuts a real generation: within a second the slot no longer works', async () => {
    const handler = createAgentHandler(core);
    const controller = new AbortController();
    const response = await handler(
      new Request(`${AGENT_ENDPOINT}/c/smoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          v: 1,
          messageId: 'm1',
          // Every turn has its tools since phase 4: the model is told to answer in text, not to run a counter.
          request: { messages: [{ role: 'user', content: 'Without using any tool, write the numbers from 1 to 500 in your reply, one per line.' }], modelId: '' },
          clientTools: [],
        }),
        signal: controller.signal,
      }),
    );
    expect(response.status).toBe(200);

    // Read until the model is well into its answer (reasoning or text), then stop.
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let pieces = 0;
    const seen: string[] = [];
    while (pieces < 20) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        const type = line ? (JSON.parse(line) as { type: string }).type : '';
        if (type && !seen.includes(type)) seen.push(type);
        if (type === 'text-delta' || type === 'thinking-delta') pieces += 1;
      }
    }
    expect(pieces, `the stream said: ${seen.join(', ')}`).toBe(20);
    expect((await engine.client.slots()).some((slot) => slot.processing)).toBe(true);

    controller.abort();
    const stopped = Date.now();
    await expect.poll(async () => (await engine.client.slots()).some((slot) => slot.processing), { timeout: 1_000 }).toBe(false);
    console.log(`[smoke] the slot stopped working ${Date.now() - stopped} ms after Stop`);
  }, TIMEOUT);

  // ── The memory: through the conversation engine and the handler, as the app's turns go ──

  interface Turned {
    text: string;
    steps: string[];
    usage: Usage;
    /** How long the restore step lasted, as the turn waited for it. */
    restoreMs: number | null;
  }

  /** One turn of a conversation, as the window's turns run: the conversation made sure of, then the turn. */
  async function turnIn(id: string, text: string): Promise<Turned> {
    await core.conversationStore.ensure(id, { kind: 'code', engineId: 'builtin', modelId: MODEL!, mode: 'repetition' });
    const steps: string[] = [];
    let reply = '';
    let restoreStarted = 0;
    let restoreMs: number | null = null;
    const result = await core.conversations.turn(id, { text, thinking: false }, (event) => {
      if (event.type === 'step') {
        steps.push(`${event.name}:${event.phase}`);
        if (event.name === 'restore' && event.phase === 'start') restoreStarted = performance.now();
        if (event.name === 'restore' && event.phase === 'end') restoreMs = performance.now() - restoreStarted;
      } else if (event.type === 'text') {
        reply += event.delta;
      }
    });
    return { text: reply, steps, usage: result.usage, restoreMs };
  }

  /** The manifests the KV store keeps: the conversations' states, or (`seeds`) the shared prefixes. */
  async function manifests(sub: '' | 'seeds' = ''): Promise<{ name: string; promptTokenCount: number; served?: number }[]> {
    const dir = join(dataDir, 'kv-slots', sub);
    const names = (await readdir(dir)).filter((name) => name.endsWith('.manifest.json'));
    return Promise.all(names.map(async (name) => ({ name, ...JSON.parse(await readFile(join(dir, name), 'utf8')) })));
  }

  it('a conversation leaves the slot saved, and comes back restored: no re-read, its tokens served by the cache', async () => {
    const first = await turnIn('smoke-memory-a', 'Remember this code word: MARMALADE. Reply with OK and nothing else.');
    console.log(`[smoke] A, first turn: « ${first.text.trim().slice(0, 60)} » (${first.usage.inputTokens} tokens read)`);

    // Another conversation takes the slot: A is saved as it leaves.
    await turnIn('smoke-memory-b', 'Reply with exactly the word OMEGA.');
    const saved = (await manifests()).find((manifest) => manifest.name.startsWith('smoke-memory-a'));
    expect(saved).toBeDefined();
    const announced = await core.conversations.open('smoke-memory-a');
    expect(announced?.kind).toBe('restore');

    const second = await turnIn('smoke-memory-a', 'What is the code word I gave you? Reply with the word only.');
    console.log(
      `[smoke] A restored in ${second.restoreMs?.toFixed(0)} ms: ${second.usage.cacheReadTokens} tokens served by the cache ` +
        `(A had saved ${saved!.promptTokenCount}); answer « ${second.text.trim().slice(0, 60)} »`,
    );
    expect(second.steps).toContain('restore:end');
    expect(second.steps.filter((step) => step.startsWith('reread'))).toEqual([]);
    expect(second.text.toUpperCase()).toContain('MARMALADE');
    // Every token the state held, but the tail after llama.cpp's last checkpoint (and the last token
    // generated, never decoded into the slot).
    expect(second.usage.cacheReadTokens ?? 0).toBeGreaterThanOrEqual(saved!.promptTokenCount - 1 - CHECKPOINT_TAIL);
  }, TIMEOUT);

  it("a branch starts from the state its conversation saved, not from what the slot held", async () => {
    // The slot is given to another conversation first: what the branch gets from the cache
    // can only come from A's saved state, copied to the branch.
    await turnIn('smoke-memory-b', 'Reply with exactly the word SIGMA.');
    const before = (await manifests()).find((manifest) => manifest.name.startsWith('smoke-memory-a'))!;

    // The window asks A's last answer again: the same history, ending on the person's message.
    const history = [
      { role: 'user', content: 'Remember this code word: MARMALADE. Reply with OK and nothing else.' },
      { role: 'assistant', content: 'OK' },
      { role: 'user', content: 'What is the code word I gave you? Reply with the word only.' },
    ];
    const handler = createAgentHandler(core);
    const response = await handler(
      new Request(`${AGENT_ENDPOINT}/c/smoke-memory-a`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, messageId: 'm-retry', request: { messages: history, modelId: '' }, clientTools: [] }),
      }),
    );
    expect(response.status).toBe(200);
    const events = (await response.text())
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; name?: string; delta?: string; usage?: Usage });
    const done = events.find((event) => event.type === 'run-done');
    const text = events.map((event) => (event.type === 'text-delta' ? event.delta : '')).join('');
    console.log(
      `[smoke] branch: ${done?.usage?.cacheReadTokens} tokens served from A's saved state (it held ${before.promptTokenCount}); ` +
        `answer « ${text.trim().slice(0, 60)} »`,
    );
    expect(events.some((event) => event.type === 'step-start' && event.name === 'reread')).toBe(false);
    expect(text.toUpperCase()).toContain('MARMALADE');
    // The branch shares everything up to the person's last message: the saved answer is all it leaves out.
    expect(done?.usage?.cacheReadTokens ?? 0).toBeGreaterThanOrEqual(Math.floor(before.promptTokenCount * 0.9));
  }, TIMEOUT);

  it('the seed one fresh conversation prepared serves the next one', async () => {
    const seeds = await manifests('seeds');
    expect(seeds).toHaveLength(1);
    const seed = seeds[0]!;
    const fresh = await turnIn('smoke-memory-c', 'Reply with exactly the word DELTA.');
    const after = (await manifests('seeds'))[0]!;
    console.log(
      `[smoke] fresh conversation: ${fresh.usage.cacheReadTokens} tokens served from the seed (it holds ${seed.promptTokenCount}); ` +
        `served ${seed.served} → ${after.served}`,
    );
    expect(fresh.steps).toContain('seed:end');
    expect(fresh.steps.filter((step) => step.startsWith('reread'))).toEqual([]);
    expect(fresh.text.toUpperCase()).toContain('DELTA');
    expect(after.served).toBe((seed.served ?? 0) + 1);
    // The whole seed, but the tail after llama.cpp's last checkpoint.
    expect(fresh.usage.cacheReadTokens ?? 0).toBeGreaterThanOrEqual(seed.promptTokenCount - CHECKPOINT_TAIL);
  }, TIMEOUT);

  // ── The agent: through aparté's stock runner and the handler, as the window's turns go ──

  type Runner = ReturnType<typeof createAgentStreamRunner>;
  type RunnerOptions = Parameters<Runner>[0];

  /** aparté's runner, wired to the handler the way `protocol.handle` wires it in the app. */
  function runnerFor(id: string): Runner {
    const handler = createAgentHandler(core);
    return createAgentStreamRunner({
      endpoint: `${AGENT_ENDPOINT}/c/${id}`,
      fetch: (input, init) => handler(new Request(input as string, init)),
    });
  }

  /** What the client hands its runner for one turn. */
  function turnOf(messageId: string, text: string, events: StreamRunEvent[]): RunnerOptions {
    return {
      messageId,
      baseRequest: { messages: [{ role: 'user', content: text }], modelId: '' },
      emitter: (event: StreamRunEvent) => events.push(event),
      signal: new AbortController().signal,
    } as unknown as RunnerOptions;
  }

  const textOf = (events: StreamRunEvent[]): string => events.map((event) => (event.type === 'text-delta' ? event.delta : '')).join('');

  it('a real call through the runner: the model reads a file, the result comes back, it answers from it — and the prefix is kept', async () => {
    await writeFile(join(home, 'notes.txt'), 'The code word is PERIWINKLE.\n');
    await core.conversationStore.ensure('smoke-agent-read', { kind: 'code', engineId: 'builtin', modelId: MODEL!, mode: 'repetition' });
    const events: StreamRunEvent[] = [];
    const usage = (await runnerFor('smoke-agent-read')(
      turnOf('m-read', 'Use the read_file tool to read notes.txt, then reply with the code word it contains and nothing else.', events),
    )) as StreamUsage | undefined;
    const started = events.find((event) => event.type === 'tool-start');
    const answer = textOf(events).trim();
    console.log(
      `[smoke] agent: ${started?.type === 'tool-start' ? `${started.name} ${JSON.stringify(started.input)}` : 'no call'} → « ${answer.slice(-60)} »; ` +
        `last round: ${usage?.cacheReadTokens} of ${usage?.inputTokens} tokens served by the cache`,
    );
    expect(started).toMatchObject({ type: 'tool-start', name: 'read_file' });
    expect(events.map((event) => event.type)).toContain('tool-resolved');
    expect(answer.toUpperCase()).toContain('PERIWINKLE');
    // Case 4 of v0: after the round trip the prompt is the first round's, the call and its result —
    // all but the result (and llama.cpp's checkpoint tail) served by the cache.
    expect((usage?.inputTokens ?? 0) - (usage?.cacheReadTokens ?? 0)).toBeLessThan(100);
  }, TIMEOUT);

  it('a real edit pauses for the person; their answer resumes the turn, and only then is the file written', async () => {
    await writeFile(join(home, 'todo.txt'), 'buy milk\n');
    await core.conversationStore.ensure('smoke-agent-edit', { kind: 'code', engineId: 'builtin', modelId: MODEL!, mode: 'repetition' });
    const runner = runnerFor('smoke-agent-edit');
    const ask = 'Use the edit_file tool on todo.txt to replace "buy milk" with "buy bread". Then reply with DONE.';
    const first: StreamRunEvent[] = [];
    await runner(turnOf('m-edit', ask, first));
    const suspended = first.at(-1) as Extract<StreamRunEvent, { type: 'run-suspended' }> & { ticket?: string };
    console.log(`[smoke] agent paused: ${JSON.stringify(suspended.type === 'run-suspended' ? suspended.pending : suspended)}`);
    expect(suspended.type).toBe('run-suspended');
    expect(suspended.pending).toMatchObject([{ name: 'edit_file', reason: 'approval' }]);
    expect(await readFile(join(home, 'todo.txt'), 'utf8')).toBe('buy milk\n');

    const second: StreamRunEvent[] = [];
    const outcomes = { [suspended.pending[0]!.toolCallId]: { kind: 'decision', approved: true } };
    await runner({ ...turnOf('m-edit', ask, second), deferral: { token: suspended.ticket, outcomes } } as unknown as RunnerOptions);
    console.log(`[smoke] agent resumed: ${second.map((event) => event.type).join(', ')} → « ${textOf(second).trim().slice(-60)} »`);
    expect(second.map((event) => event.type)).toEqual(expect.arrayContaining(['tool-approved', 'tool-resolved', 'run-done']));
    expect(await readFile(join(home, 'todo.txt'), 'utf8')).toBe('buy bread\n');
  }, TIMEOUT);
});

