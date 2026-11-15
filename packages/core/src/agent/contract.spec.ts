/**
 * The contract with aparté. The window uses aparté's stock runner
 * (`createAgentStreamRunner`) as it is, and our handler speaks its wire by
 * hand: the names of the events are frozen until aparté 2.0, their fields are
 * not. These tests run the REAL runner against our handler. They are the alarm
 * that rings when a minor release of aparté changes the protocol.
 */

import { createAgentStreamRunner } from '@aparte/core';
import type { StreamRunEvent, StreamUsage } from '@aparte/engine';
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

type Runner = ReturnType<typeof createAgentStreamRunner>;
type RunnerOptions = Parameters<Runner>[0];

/** aparté's runner, wired to our handler the way `protocol.handle` wires it in the app. */
async function setup(options: FakeLlamaServerOptions | 'no engine' = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bp-contract-'));
  let server: FakeLlamaServer | undefined;
  if (options !== 'no engine') {
    server = await startFakeLlamaServer(options);
    servers.push(server);
    await mkdir(join(dataDir, 'config'), { recursive: true });
    await writeFile(
      join(dataDir, 'config', 'global.json'),
      JSON.stringify({ backend: { mode: 'remote', url: server.url } }),
    );
  }
  const core = createCore({ dataDir, env: {}, logger: () => undefined });
  const handler = createAgentHandler(core);
  const runner = createAgentStreamRunner({
    endpoint: `${AGENT_ENDPOINT}/c/c1`,
    fetch: (input, init) => handler(new Request(input as string, init)),
  });
  return { server, runner, core };
}

/** What the client hands its runner for one turn: only what the stock runner reads. */
function turnOf(text: string, events: StreamRunEvent[], signal = new AbortController().signal): RunnerOptions {
  return {
    messageId: 'm1',
    baseRequest: { messages: [{ role: 'user', content: text }], modelId: '' },
    emitter: (event: StreamRunEvent) => events.push(event),
    signal,
  } as unknown as RunnerOptions;
}

const textOf = (events: StreamRunEvent[]) =>
  events.map((event) => (event.type === 'text-delta' ? event.delta : '')).join('');

describe("aparté's stock runner drives our handler", () => {
  it('replays the answer, and returns the usage of the turn', async () => {
    const { runner } = await setup({ responder: () => 'Bonjour Paul' });
    const events: StreamRunEvent[] = [];
    const usage = (await runner(turnOf('Bonjour', events))) as StreamUsage | undefined;

    expect(events[0]).toEqual({ type: 'run-start' });
    expect(textOf(events)).toBe('Bonjour Paul');
    expect(events.at(-1)!.type).toBe('run-done');
    expect(usage?.inputTokens).toBeGreaterThan(0);
    expect(usage?.outputTokens).toBeGreaterThan(0);
  });

  it('stops quietly when the turn is stopped, and the engine stops generating', async () => {
    const { server, runner } = await setup({
      paceMs: 20,
      responder: () => 'un deux trois quatre cinq six sept huit neuf dix',
    });
    const controller = new AbortController();
    const events: StreamRunEvent[] = [];
    const options = turnOf('Compte', events, controller.signal);
    const emit = options.emitter;
    options.emitter = (event) => {
      emit(event);
      if (event.type === 'text-delta') controller.abort();
    };

    // A stop is not a failure: the runner returns, it does not throw.
    await expect(runner(options)).resolves.toBeUndefined();
    await expect.poll(() => server!.aborted, { timeout: 2_000 }).toBe(1);
  });

  it('turns a run-error line into an error that carries our message', async () => {
    const { runner } = await setup({ nCtx: 4 });
    // A server that refuses the prompt as too long: the conversation is full, said in our words.
    await expect(runner(turnOf('Bonjour, comment vas-tu ?', []))).rejects.toThrow(/The conversation is full/);
  });

  it('turns a refusal before the stream into an error that carries our message', async () => {
    const { runner } = await setup('no engine');
    await expect(runner(turnOf('Bonjour', []))).rejects.toThrow(/No model is loaded/);
  });
});

describe("aparté's stock runner, through a pause", () => {
  it('reads run-suspended; called again with its deferral, it resumes and reads the rest of the turn', async () => {
    const touch = '<|tool_call>call:touch_test{}<tool_call|>';
    const { runner, core } = await setup({
      responder: (prompt) => (prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user') ? 'Done.' : touch),
    });
    let touched = 0;
    core.tools.register(
      { name: 'touch_test', description: 'Touch the test.', inputSchema: { type: 'object', properties: {} }, effect: 'write', source: 'builtin', where: 'core' },
      async () => {
        touched += 1;
        return { content: 'touched' };
      },
    );

    const first: StreamRunEvent[] = [];
    await runner(turnOf('Go', first));
    const suspended = first.at(-1) as Extract<StreamRunEvent, { type: 'run-suspended' }> & { ticket?: string };
    expect(suspended.type).toBe('run-suspended');
    expect(suspended.pending).toMatchObject([{ name: 'touch_test', reason: 'approval' }]);
    expect(typeof suspended.ticket).toBe('string');
    expect(touched).toBe(0);

    const second: StreamRunEvent[] = [];
    const outcomes = { [suspended.pending[0]!.toolCallId]: { kind: 'decision', approved: true } };
    await runner({ ...turnOf('Go', second), deferral: { token: suspended.ticket, outcomes } } as unknown as RunnerOptions);
    expect(second.map((event) => event.type)).toEqual(expect.arrayContaining(['tool-approved', 'tool-resolved', 'run-done']));
    expect(textOf(second)).toContain('Done.');
    expect(touched).toBe(1);
  });
});
