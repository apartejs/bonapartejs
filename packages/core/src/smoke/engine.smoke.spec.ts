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
 * 5. Stop cuts a real generation: within a second the slot no longer works.
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

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_ENDPOINT, createAgentHandler } from '../agent/handler.js';
import { createCore, type Core, type Engine } from '../api.js';
import type { DemuxEvent } from '../families/types.js';
import { PromptLog } from '../prompt/prompt-log.js';
import type { ToolDef } from '../tools/types.js';

const MODEL = process.env['BONAPARTE_SMOKE_MODEL'];
const LLAMA = process.env['BONAPARTE_SMOKE_LLAMA'];
const N_CTX = Number(process.env['BONAPARTE_SMOKE_CTX'] ?? 8192);
const PORT = 8127;
/** A big model takes its time on a first load. */
const TIMEOUT = 900_000;
/** A small model at its default temperature is a coin flip on protocol details: the smoke judges the harness. */
const SAMPLING = { temperature: 0.2, seed: 42 };

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
  let core: Core;
  let engine: Engine;

  /** A system prompt that declares the tools, in the family's convention. */
  function systemWithTools(tools: readonly ToolDef[]): string {
    return [
      'You are bonaparte, a coding agent. Answer briefly.',
      engine.family.renderToolConvention(),
      engine.family.renderToolInventory(tools),
    ].join('\n\n');
  }

  /** One answer under the lazy tool grammar, read by the family's demux. */
  async function answer(user: string, tools: readonly ToolDef[]): Promise<{ text: string; events: DemuxEvent[] }> {
    const log = new PromptLog(engine.family);
    log.appendSystem(systemWithTools(tools));
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
    core = createCore({
      dataDir,
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
    for (const thinking of [false, true]) {
      const messages = [
        { role: 'system', content: 'You are bonaparte.' },
        { role: 'user', content: 'Bonjour' },
      ];
      let theirs: string;
      try {
        theirs = await engine.client.applyTemplate(messages, { enable_thinking: thinking });
      } catch (error) {
        console.log(`[smoke] /apply-template is not available: ${String(error)}`);
        context.skip();
        return;
      }
      const log = new PromptLog(engine.family);
      log.appendSystem('You are bonaparte.');
      log.appendUser('Bonjour');
      const ours = log.beginAssistantTurn({ thinking });
      // The server adds the BOS token itself when it tokenizes a /completion prompt: ours has none.
      expect(theirs.replace(/^<bos>/, ''), `thinking ${thinking}`).toBe(ours);
    }
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
          request: { messages: [{ role: 'user', content: 'Count from 1 to 500, one number per line.' }], modelId: '' },
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
    while (pieces < 20) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        const type = line ? (JSON.parse(line) as { type: string }).type : '';
        if (type === 'text-delta' || type === 'thinking-delta') pieces += 1;
      }
    }
    expect(pieces).toBe(20);
    expect((await engine.client.slots()).some((slot) => slot.processing)).toBe(true);

    controller.abort();
    const stopped = Date.now();
    await expect.poll(async () => (await engine.client.slots()).some((slot) => slot.processing), { timeout: 1_000 }).toBe(false);
    console.log(`[smoke] the slot stopped working ${Date.now() - stopped} ms after Stop`);
  }, TIMEOUT);
});
