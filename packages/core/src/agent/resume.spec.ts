/**
 * A paused turn resumes with its ticket and the answers to its calls: a
 * decision approved runs the call and the answer goes on in the same
 * response; a refusal reaches the model word for word; a result of the
 * window's tool is the call's result. A ticket changed, of another message,
 * or answers missing are refused (400); a pause answered once is answered.
 * It all holds across a restart: a new core on the same data folder resumes.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, type Core } from '../api.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';
import { AGENT_ENDPOINT, createAgentHandler } from './handler.js';

let servers: FakeLlamaServer[] = [];
let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  servers = [];
  dirs = [];
});

const Q = '<|"|>';
type Line = { type: string } & Record<string, any>;

/** The model calls `call` once, then answers « Done. » once it has read the result. */
function model(call: string) {
  return (prompt: string) => (prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user') ? 'Done.' : call);
}

async function setup(call: string, dataDir?: string, home?: string) {
  const prompts: string[] = [];
  const server = await startFakeLlamaServer({ responder: model(call), onCompletion: (body) => prompts.push(String(body['prompt'])) });
  servers.push(server);
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), 'bp-resume-')));
  if (!dataDir) dirs.push(dir);
  await mkdir(join(dir, 'config'), { recursive: true });
  await writeFile(join(dir, 'config', 'global.json'), JSON.stringify({ backend: { mode: 'remote', url: server.url } }));
  return { ...wire(createCore({ dataDir: dir, env: {}, logger: () => undefined, ...(home ? { home } : {}) })), prompts, dir };
}

function wire(core: Core) {
  const touched: unknown[] = [];
  core.tools.register(
    {
      name: 'touch_test',
      description: 'Touch the test.',
      inputSchema: { type: 'object', properties: {} },
      effect: 'write',
      source: 'builtin',
      where: 'core',
    },
    async (call) => {
      touched.push(call.input);
      return { content: 'touched' };
    },
  );
  return { core, handler: createAgentHandler(core), touched };
}

function post(handler: (request: Request) => Promise<Response>, body: Record<string, unknown>) {
  return handler(
    new Request(`${AGENT_ENDPOINT}/c/c1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        v: 1,
        messageId: 'm1',
        request: { messages: [{ role: 'user', content: 'Go' }], modelId: '' },
        clientTools: [],
        ...body,
      }),
    }),
  );
}

async function lines(response: Response): Promise<Line[]> {
  return (await response.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Line);
}

async function paused(handler: (request: Request) => Promise<Response>, body: Record<string, unknown> = {}) {
  const ended = (await lines(await post(handler, body))).at(-1)!;
  expect(ended.type).toBe('run-suspended');
  return { ticket: ended['ticket'] as string, pending: ended['pending'] as { toolCallId: string; name: string; reason: string }[] };
}

const TOUCH = '<|tool_call>call:touch_test{}<tool_call|>';

describe('resuming a paused turn', () => {
  it('a write outside the project, asked and allowed, is written where the card showed it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bp-resume-outside-'));
    dirs.push(dir);
    const home = join(dir, 'project');
    await mkdir(home, { recursive: true });
    const Q = '<|"|>';
    const write = `<|tool_call>call:write_file{path:${Q}../beside.txt${Q},content:${Q}allowed${Q}}<tool_call|>`;
    const { handler } = await setup(write, dir, home);
    const { ticket, pending } = await paused(handler);
    expect(pending).toMatchObject([{ name: 'write_file', reason: 'approval' }]);
    const resumed = await lines(await post(handler, { resume: { ticket, outcomes: { [pending[0]!.toolCallId]: { kind: 'decision', approved: true } } } }));
    expect(resumed.map((line) => line.type)).toContain('tool-resolved');
    expect(await readFile(join(dir, 'beside.txt'), 'utf8')).toBe('allowed');
  });

  it('a decision approved runs the call, and the answer goes on in the same response', async () => {
    const { handler, touched } = await setup(TOUCH);
    const { ticket, pending } = await paused(handler);
    expect(touched).toEqual([]);
    const resumed = await lines(await post(handler, { resume: { ticket, outcomes: { [pending[0]!.toolCallId]: { kind: 'decision', approved: true } } } }));
    expect(resumed.map((line) => line.type)).toEqual(expect.arrayContaining(['tool-approved', 'tool-resolved', 'run-done']));
    expect(resumed.filter((line) => line.type === 'text-delta').map((line) => line['delta']).join('')).toContain('Done.');
    expect(touched).toHaveLength(1);
  });

  it('a refusal reaches the model word for word, with what the person said', async () => {
    const { handler, touched, prompts } = await setup(TOUCH);
    const { ticket, pending } = await paused(handler);
    const outcome = { kind: 'decision', approved: false, instruction: 'Use the other file, notes.md.' };
    const resumed = await lines(await post(handler, { resume: { ticket, outcomes: { [pending[0]!.toolCallId]: outcome } } }));
    expect(resumed.find((line) => line.type === 'tool-rejected')).toMatchObject({ by: 'person', instruction: 'Use the other file, notes.md.' });
    expect(prompts.at(-1)).toContain('Use the other file, notes.md.');
    expect(touched).toEqual([]);
  });

  it("a result of the window's tool is the call's result", async () => {
    const { handler, prompts } = await setup(`<|tool_call>call:ask_user{question:${Q}Which colour?${Q}}<tool_call|>`);
    const clientTools = [{ name: 'ask_user', description: 'Ask the person.', inputSchema: { type: 'object', properties: {} } }];
    const { ticket, pending } = await paused(handler, { clientTools });
    expect(pending[0]).toMatchObject({ name: 'ask_user', reason: 'external' });
    const resumed = await lines(
      await post(handler, { clientTools, resume: { ticket, outcomes: { [pending[0]!.toolCallId]: { kind: 'result', content: 'blue' } } } }),
    );
    expect(resumed.find((line) => line.type === 'tool-resolved')).toMatchObject({ result: 'blue' });
    expect(prompts.at(-1)).toContain('blue');
  });

  it('a ticket changed, of another message, or answers missing resume nothing (400)', async () => {
    const { handler } = await setup(TOUCH);
    const { ticket, pending } = await paused(handler);
    const approve = { [pending[0]!.toolCallId]: { kind: 'decision', approved: true } };
    const [payload, signature] = ticket.split('.');
    expect((await post(handler, { resume: { ticket: `${payload}x.${signature}`, outcomes: approve } })).status).toBe(400);
    expect((await post(handler, { messageId: 'm2', resume: { ticket, outcomes: approve } })).status).toBe(400);
    expect((await post(handler, { resume: { ticket, outcomes: {} } })).status).toBe(400);
  });

  it('a pause answered once is answered: the same ticket again resumes nothing (409)', async () => {
    const { handler } = await setup(TOUCH);
    const { ticket, pending } = await paused(handler);
    const approve = { [pending[0]!.toolCallId]: { kind: 'decision', approved: true } };
    await lines(await post(handler, { resume: { ticket, outcomes: approve } }));
    expect((await post(handler, { resume: { ticket, outcomes: approve } })).status).toBe(409);
  });

  it('after a restart — a new core on the same data folder — the pause resumes', async () => {
    const first = await setup(TOUCH);
    const { ticket, pending } = await paused(first.handler);
    await first.core.stop();
    const again = wire(createCore({ dataDir: first.dir, env: {}, logger: () => undefined }));
    const resumed = await lines(await post(again.handler, { resume: { ticket, outcomes: { [pending[0]!.toolCallId]: { kind: 'decision', approved: true } } } }));
    expect(resumed.at(-1)?.type).toBe('run-done');
    expect(again.touched).toHaveLength(1);
  });
});
