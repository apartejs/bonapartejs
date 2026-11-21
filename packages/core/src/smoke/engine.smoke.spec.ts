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
 * llama.cpp binary, else found on the PATH) · BONAPARTE_SMOKE_CTX (8192) ·
 * BONAPARTE_SMOKE_MODEL2 (a model of another family: the change of model,
 * task 7.4; skipped without it).
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
const MODEL2 = process.env['BONAPARTE_SMOKE_MODEL2'];
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
  // The language the replies are asked in: the interface's, changed by the person (Settings, General).
  let replyLanguage = 'English';

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
      modelRoots: [{ dir: dirname(MODEL!), source: 'manual' }, ...(MODEL2 ? [{ dir: dirname(MODEL2), source: 'manual' as const }] : [])],
      replyLanguage: () => replyLanguage,
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
    // The conversation's temperature over its family's sampling (audit D6): the smoke's turns sample as fixed as its
    // direct calls — Qwen3 without reasoning samples at 0.7, where a 1.7B model echoed its last answer.
    const result = await core.conversations.turn(id, { text, thinking: false, temperature: SAMPLING.temperature }, (event) => {
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

  /**
   * A conversation the runner's turns go to, its temperature the smoke's: since audit D6 a turn samples by its family
   * unless its conversation says otherwise, and Gemma 4 at its own 1.0 handed two leads one per step, never in one
   * (2026-11-21) — the smoke judges the harness, not the model's initiative.
   */
  async function smokeConversation(id: string): Promise<void> {
    await core.conversationStore.ensure(id, { kind: 'code', engineId: 'builtin', modelId: MODEL!, mode: 'repetition' });
    await core.conversationStore.settle(id, { temperature: SAMPLING.temperature });
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
    await smokeConversation('smoke-agent-read');
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
    await smokeConversation('smoke-agent-edit');
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

  it('a change of the reply language is a note at the next message: the answer follows it, the prefix is kept', async () => {
    replyLanguage = 'French';
    try {
      const first = await turnIn('smoke-language', 'How many days are in a week? Answer with the number written in words, and nothing else.');
      replyLanguage = 'English';
      const second = await turnIn('smoke-language', 'And in two weeks? Answer with the number written in words, and nothing else.');
      console.log(
        `[smoke] reply language: « ${first.text.trim().slice(0, 40)} » then « ${second.text.trim().slice(0, 40)} »; ` +
          `${second.usage.cacheReadTokens} of ${second.usage.inputTokens} tokens served by the cache`,
      );
      expect(first.text.toLowerCase()).toContain('sept');
      expect(second.text.toLowerCase()).toContain('fourteen');
      // The note is appended: everything read before is still the start of the prompt.
      expect(second.usage.cacheReadTokens ?? 0).toBeGreaterThanOrEqual(first.usage.inputTokens - CHECKPOINT_TAIL);
    } finally {
      replyLanguage = 'English';
    }
  }, TIMEOUT);

  it('unloading saves the memory in the engine; reloaded or restarted, the conversation is restored, not read again', async () => {
    await turnIn('smoke-unload', 'Remember this code word: QUINCE. Reply with OK and nothing else.');
    await core.unloadModel();
    expect(await core.engineState()).toMatchObject({ status: 'stopped' });
    await core.loadModel(MODEL!);
    engine = (await core.engine())!;
    const reloaded = await turnIn('smoke-unload', 'What is the code word I gave you? Reply with the word only.');
    const started = Date.now();
    await core.restartEngine();
    const restartSeconds = (Date.now() - started) / 1000;
    engine = (await core.engine())!;
    const restarted = await turnIn('smoke-unload', 'Say the code word once more, the word only.');
    console.log(
      `[smoke] unload → reload: restored in ${reloaded.restoreMs?.toFixed(0)} ms, « ${reloaded.text.trim().slice(0, 30)} »; ` +
        `restart in ${restartSeconds.toFixed(1)} s, restored in ${restarted.restoreMs?.toFixed(0)} ms, « ${restarted.text.trim().slice(0, 30)} »`,
    );
    for (const turned of [reloaded, restarted]) {
      expect(turned.steps).toContain('restore:end');
      expect(turned.steps.filter((step) => step.startsWith('reread'))).toEqual([]);
      expect(turned.text.toUpperCase()).toContain('QUINCE');
    }
  }, TIMEOUT);

  // ── Phase 7: the memory after a long answer, going back, compaction, a change of model ──

  it('after a long answer, a conversation saved and restored reads only the checkpoint tail, not its last answer', async () => {
    const first = await turnIn('smoke-long', 'Write a paragraph of about 150 words about the sea. Plain prose.');
    // Another conversation takes the slot: the long one is saved as it leaves — its last answer read to its end first.
    await turnIn('smoke-memory-b', 'Reply with exactly the word KAPPA.');
    const saved = (await manifests()).find((manifest) => manifest.name.startsWith('smoke-long'))! as {
      promptTokenCount: number;
      slotFileBytes?: number;
    };
    const second = await turnIn('smoke-long', 'Reply with the word DONE.');
    const uncached = second.usage.inputTokens - (second.usage.cacheReadTokens ?? 0);
    console.log(
      `[smoke] long answer (${first.usage.outputTokens} tokens): saved ${saved.promptTokenCount} tokens, ` +
        `${((saved.slotFileBytes ?? 0) / 1024 ** 2).toFixed(1)} MiB, restored in ${second.restoreMs?.toFixed(0)} ms; ` +
        `${second.usage.cacheReadTokens} of ${second.usage.inputTokens} served by the cache (${uncached} read)`,
    );
    expect(second.steps).toContain('restore:end');
    expect(second.steps.filter((step) => step.startsWith('reread'))).toEqual([]);
    expect(second.usage.cacheReadTokens ?? 0).toBeGreaterThanOrEqual(saved.promptTokenCount - 1 - CHECKPOINT_TAIL);
  }, TIMEOUT);

  it('going back before the last message: served by the cache, as the estimate said', async () => {
    const id = 'smoke-rewind';
    await turnIn(id, 'Remember this code word: BASIL. Reply with OK and nothing else.');
    await turnIn(id, 'Write two sentences about bread.');
    const last = 'Write two sentences about tea.';
    await turnIn(id, last);
    const target = { userIndex: 2, text: last };
    const estimate = await core.conversations.rewindMemory(id, target);
    await core.rewind(id, target, 'conversation');
    const after = await turnIn(id, 'What is the code word I gave you? Reply with the word only.');
    const uncached = after.usage.inputTokens - (after.usage.cacheReadTokens ?? 0);
    console.log(
      `[smoke] rewind: estimated ${estimate === 'kept' ? 'kept' : `${estimate?.tokens} tokens to read again`}; ` +
        `${after.usage.cacheReadTokens} of ${after.usage.inputTokens} served by the cache (${uncached} read); « ${after.text.trim().slice(0, 30)} »`,
    );
    expect(after.text.toUpperCase()).toContain('BASIL');
    expect(after.steps.filter((step) => step.startsWith('reread'))).toEqual([]);
    // Kept: the new message and the checkpoint tail at most; else what was announced, and the message.
    const announced = estimate === 'kept' || estimate === null ? 0 : estimate.tokens;
    expect(uncached).toBeLessThanOrEqual(announced + 64);
  }, TIMEOUT);

  it('a compaction keeps a secret the model read in a file: asked after it, the model still knows it', async () => {
    // The conversation where the model read notes.txt (PERIWINKLE): long enough, with a few turns more, to compact.
    const id = 'smoke-agent-read';
    for (const topic of ['the sea', 'mountains', 'forests', 'deserts', 'rivers']) {
      await turnIn(id, `Write about 350 words about ${topic}. Plain prose, no lists.`);
    }
    const result = await core.compact(id);
    console.log(
      `[smoke] compaction: ${result.ok ? `${result.tokensBefore} → ${result.tokensAfter} tokens (estimated), ${result.compactedTurns} turns folded, the code word ${result.summary.toUpperCase().includes('PERIWINKLE') ? 'kept' : 'LOST'} in a summary of ${result.summary.length} characters` : `refused (${result.reason})`}`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The summary itself keeps it: asked without tools, the model can only answer from it.
    expect(result.summary.toUpperCase()).toContain('PERIWINKLE');
    const after = await turnIn(id, 'What was the code word in notes.txt? Reply with the word only.');
    console.log(`[smoke] after the compaction: « ${after.text.trim().slice(0, 40)} », ${after.usage.inputTokens} tokens read`);
    expect(after.text.toUpperCase()).toContain('PERIWINKLE');
  }, TIMEOUT);

  // ── Phase 8: sub-agents, on the slot their turn lends, then on two slots ──

  interface Leads {
    events: StreamRunEvent[];
    usage: StreamUsage | undefined;
    seconds: number;
  }

  /** One turn that hands the model's leads to sub-agents: each reads one file and gives its code word back. */
  async function leads(id: string, files: Record<string, string>): Promise<Leads> {
    for (const [name, word] of Object.entries(files)) await writeFile(join(home, name), `The code word is ${word}.\n`);
    await smokeConversation(id);
    const names = Object.keys(files);
    const ask =
      `Call the run_subagent tool ${names.length} times in this same step, one call for each of these files: ${names.join(', ')}. ` +
      'Give each the name of its file, tools "read", and this mission: "Use the read_file tool to read <the file>, then reply with the code word it contains and nothing else." ' +
      'When their results come back, reply with the code words they found, separated by spaces, and nothing else.';
    const events: StreamRunEvent[] = [];
    const started = Date.now();
    const options = turnOf(`m-${id}`, ask, events);
    const usage = (await runnerFor(id)({
      ...options,
      emitter: (event: StreamRunEvent) => {
        events.push(event);
        // What each sub-agent did, and when: the verdict of « together » or « in turn » is read from it.
        const agentId = (event as { agentId?: string }).agentId;
        if (agentId && /^(agent-start|agent-end|tool-start|tool-resolved|step-start|step-end)$/.test(event.type)) {
          const name = (event as { name?: string }).name;
          console.log(`[smoke]   +${((Date.now() - started) / 1000).toFixed(1)} s ${agentId.slice(-6)} ${event.type}${name ? ` ${name}` : ''}`);
        }
      },
    } as RunnerOptions)) as StreamUsage | undefined;
    return { events, usage, seconds: (Date.now() - started) / 1000 };
  }

  /** What each sub-agent did, in the order of the stream: when it started, its first tool, when it ended. */
  function agentsOf(events: StreamRunEvent[]): { id: string; start: number; firstTool: number; end: number; status?: string }[] {
    const agents = new Map<string, { id: string; start: number; firstTool: number; end: number; status?: string }>();
    events.forEach((event, at) => {
      const agentId = (event as { agentId?: string }).agentId;
      if (!agentId) return;
      const agent = agents.get(agentId) ?? { id: agentId, start: at, firstTool: -1, end: -1 };
      if (event.type === 'tool-start' && agent.firstTool < 0) agent.firstTool = at;
      if (event.type === 'agent-end') {
        agent.end = at;
        agent.status = (event as { status?: string }).status;
      }
      agents.set(agentId, agent);
    });
    return [...agents.values()];
  }

  it('three real sub-agents in turn on the slot their turn lends: each gives its word back, and the conversation goes on from its memory', async () => {
    const result = await leads('smoke-subagents', { 'alpha.txt': 'JUNIPER', 'beta.txt': 'CARDAMOM', 'gamma.txt': 'SORREL' });
    const agents = agentsOf(result.events);
    // The conversation's own answer: the sub-agents' words are theirs.
    const answer = textOf(result.events.filter((event) => !(event as { agentId?: string }).agentId)).trim();
    const uncached = (result.usage?.inputTokens ?? 0) - (result.usage?.cacheReadTokens ?? 0);
    console.log(
      `[smoke] sub-agents in turn: ${agents.length} ran (${agents.map((agent) => agent.status).join(', ')}) in ${result.seconds.toFixed(1)} s; ` +
        `« ${answer.slice(-80)} »; the conversation's last round: ${result.usage?.cacheReadTokens} of ${result.usage?.inputTokens} served by the cache (${uncached} read)`,
    );
    expect(agents).toHaveLength(3);
    expect(agents.every((agent) => agent.status === 'done')).toBe(true);
    // One after the other: a sub-agent works only once the one before has ended.
    const ordered = [...agents].sort((a, b) => a.firstTool - b.firstTool);
    for (let next = 1; next < ordered.length; next += 1) expect(ordered[next]!.firstTool).toBeGreaterThan(ordered[next - 1]!.end);
    for (const word of ['JUNIPER', 'CARDAMOM', 'SORREL']) expect(answer.toUpperCase()).toContain(word);
    // The slot came home: the conversation's state restored, only its calls' results read.
    expect(uncached).toBeLessThan(600);
  }, TIMEOUT);

  it('two real sub-agents in parallel on two slots: said first, then both at once — and the conversation goes on from its memory', async () => {
    const cost = await core.restartCost({ subagents: 'parallel' });
    console.log(`[smoke] « En parallèle »: ${cost.parallel?.slots} slots, ${((cost.parallel?.vramBytesEach ?? 0) / 1024 ** 3).toFixed(2)} GiB each`);
    expect(cost.parallel?.slots).toBe(2);
    const started = Date.now();
    await core.applyEngineSettings({ subagents: 'parallel' }, { restart: true });
    await expect.poll(async () => (await core.memory()).engine.slots, { timeout: TIMEOUT }).toBe(2);
    engine = (await core.engine())!;
    console.log(`[smoke] restarted with two slots in ${((Date.now() - started) / 1000).toFixed(1)} s`);

    // What llama.cpp itself says: how many of its slots work at once, read while the turn runs.
    let atOnce = 0;
    let watching = true;
    const watcher = (async () => {
      while (watching) {
        const working = (await engine.client.slots().catch(() => [])).filter((slot) => slot.processing).length;
        atOnce = Math.max(atOnce, working);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    })();
    const result = await leads('smoke-parallel', { 'delta.txt': 'TAMARIND', 'epsilon.txt': 'FENNEL' }).finally(() => {
      watching = false;
    });
    await watcher;
    const agents = agentsOf(result.events);
    // The conversation's own answer: the sub-agents' words are theirs.
    const answer = textOf(result.events.filter((event) => !(event as { agentId?: string }).agentId)).trim();
    const uncached = (result.usage?.inputTokens ?? 0) - (result.usage?.cacheReadTokens ?? 0);
    console.log(
      `[smoke] sub-agents in parallel: ${agents.length} ran (${agents.map((agent) => agent.status).join(', ')}) in ${result.seconds.toFixed(1)} s; ` +
        `« ${answer.slice(-80)} »; the conversation's last round: ${result.usage?.cacheReadTokens} of ${result.usage?.inputTokens} served by the cache (${uncached} read)`,
    );
    console.log(`[smoke] llama.cpp's slots working at once: ${atOnce}`);
    expect(agents).toHaveLength(2);
    expect(agents.every((agent) => agent.status === 'done')).toBe(true);
    // Together: neither waited for the engine, and llama.cpp had both slots working at once.
    const waited = result.events.filter((event) => event.type === 'step-start' && (event as { name?: string }).name === 'slot-wait');
    expect(waited).toEqual([]);
    expect(atOnce).toBe(2);
    for (const word of ['TAMARIND', 'FENNEL']) expect(answer.toUpperCase()).toContain(word);
    expect(uncached).toBeLessThan(600);
  }, TIMEOUT);

  // Phase 10: a real MCP server — the official filesystem server, through npx, launched hidden and without a shell.
  it('a real MCP server: its tool, asked as the network, approved, reads a file — the model answers from it', async () => {
    await writeFile(join(home, 'mcp-notes.txt'), 'The code word is MARJORAM.\n');
    await writeFile(
      join(dataDir, 'config', 'mcp-servers.json'),
      JSON.stringify({ mcpServers: { files: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', home] } } }),
    );
    const started = Date.now();
    await core.mcp.start('files');
    const [server] = await core.mcp.overview();
    console.log(`[smoke] mcp: ${server?.state} in ${((Date.now() - started) / 1000).toFixed(1)} s, ${server?.tools.length} tools: ${server?.tools.map((tool) => tool.name).join(', ')}`);
    expect(server).toMatchObject({ id: 'files', state: 'connected' });
    // The server names its reading tool read_text_file since 2025 (read_file before).
    const reader = server!.tools.find((tool) => tool.name === 'read_text_file') ?? server!.tools.find((tool) => tool.name === 'read_file');
    expect(reader?.readOnly).toBe(true);
    const name = `mcp__files__${reader!.name}`;
    const path = join(home, 'mcp-notes.txt');

    await smokeConversation('smoke-mcp');
    const runner = runnerFor('smoke-mcp');
    const ask = `Use the ${name} tool to read the file ${path}, then reply with the code word it contains and nothing else.`;
    const first: StreamRunEvent[] = [];
    await runner(turnOf('m-mcp', ask, first));
    const call = first.find((event) => event.type === 'tool-start');
    const last = first.at(-1) as Extract<StreamRunEvent, { type: 'run-suspended' }> & { ticket?: string };
    console.log(`[smoke] mcp call: ${call?.type === 'tool-start' ? `${call.name} ${JSON.stringify(call.input)}` : 'no call'} → ${last.type}`);
    expect(call).toMatchObject({ type: 'tool-start', name });
    // A read-only hint leaves the machine still: the call is asked as the network.
    expect(last.type).toBe('run-suspended');
    expect(last.pending).toMatchObject([{ name, reason: 'approval' }]);

    const second: StreamRunEvent[] = [];
    const outcomes = { [last.pending[0]!.toolCallId]: { kind: 'decision', approved: true } };
    const usage = (await runner({ ...turnOf('m-mcp', ask, second), deferral: { token: last.ticket, outcomes } } as unknown as RunnerOptions)) as StreamUsage | undefined;
    const answer = textOf(second).trim();
    console.log(
      `[smoke] mcp resumed: ${second.map((event) => event.type).join(', ')} → « ${answer.slice(-60)} »; last round ${usage?.cacheReadTokens} of ${usage?.inputTokens} tokens served by the cache`,
    );
    expect(second.map((event) => event.type)).toEqual(expect.arrayContaining(['tool-approved', 'tool-resolved', 'run-done']));
    expect(answer.toUpperCase()).toContain('MARJORAM');
    await core.mcp.stop('files');
  }, TIMEOUT);

  it.skipIf(!MODEL2)('a change of model: said first, then the conversation rendered again in the new family and answered there', async () => {
    const id = 'smoke-switch';
    // Not « reply with OK »: a 1.7B model without reasoning echoed that OK to the next question (2026-11-21).
    await turnIn(id, 'Remember this code word: SAFFRON. Reply with one short sentence saying you will remember it.');
    const cost = await core.modelSwitch(MODEL2!, id);
    const started = Date.now();
    await core.switchModel(MODEL2!, { conversationId: id });
    const loadSeconds = (Date.now() - started) / 1000;
    engine = (await core.engine())!;
    const after = await turnIn(id, 'What is the code word I gave you? Reply with the word only.');
    const uncached = after.usage.inputTokens - (after.usage.cacheReadTokens ?? 0);
    console.log(
      `[smoke] change of model to ${engine.family.id}: announced reload ~${cost.announcement.reloadSeconds.toFixed(1)} s, re-read ${cost.announcement.rereadTokens} tokens; ` +
        `loaded in ${loadSeconds.toFixed(1)} s; next turn read ${uncached} of ${after.usage.inputTokens}; « ${after.text.trim().slice(0, 30)} »`,
    );
    expect(engine.family.id).not.toBe('gemma');
    expect(after.text.toUpperCase()).toContain('SAFFRON');
    // What was announced is the whole prompt of the new model — its system turn served by a seed it prepared
    // first, the rest read by the turn —, estimated on the careful side (three characters a token).
    expect(cost.announcement.rereadTokens).toBeGreaterThanOrEqual(after.usage.inputTokens * 0.8);
    expect(cost.announcement.rereadTokens).toBeLessThanOrEqual(after.usage.inputTokens * 2);
  }, TIMEOUT);
});
