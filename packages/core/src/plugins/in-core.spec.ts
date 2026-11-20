/**
 * The plugin host inside the core: a plugin's tools join the one registry —
 * told to the model, run in a turn like the core's own — and what they reach
 * through `use` is judged by the one policy, in the conversation's mode and
 * perimeter. A project that turns a plugin off does not see its tools.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PluginNodeModule } from '@aparte/bonaparte-shared';
import { createCore } from '../api.js';
import { AGENT_ENDPOINT, createAgentHandler } from '../agent/handler.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';

let servers: FakeLlamaServer[] = [];
let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  servers = [];
  dirs = [];
});

type Line = { type: string } & Record<string, unknown>;

const MANIFEST = {
  id: 'notes',
  name: 'Notes',
  version: '1.0.0',
  effects: [
    { effect: 'read', what: 'the notes of the project' },
    { effect: 'write', what: 'the notes of the project' },
  ],
  contributes: {
    tools: [
      { name: 'count_notes', description: 'Counts the lines of notes.txt.', effect: 'read' },
      { name: 'stamp_notes', description: 'Writes a stamp into stamp.txt.', effect: 'write' },
    ],
  },
};

const NOTES: PluginNodeModule = {
  activate(context) {
    context.registerToolHandler('count_notes', async (call) => {
      const read = await call.use('read_file', { path: 'notes.txt' });
      return read.failed ? read : { content: `The notes say: ${read.content}` };
    });
    context.registerToolHandler('stamp_notes', async (call) => call.use('write_file', { path: 'stamp.txt', content: 'stamped\n' }));
  },
};

/** The model calls `call` once, then answers « Done. » once it has read the result. */
const model = (call: string) => (prompt: string) =>
  prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user') ? 'Done.' : call;

async function setup(call: string) {
  const prompts: string[] = [];
  const server = await startFakeLlamaServer({ nCtx: 8192, responder: model(call), onCompletion: (body) => prompts.push(String(body['prompt'])) });
  servers.push(server);
  const dir = await mkdtemp(join(tmpdir(), 'bp-plugins-'));
  dirs.push(dir);
  const home = join(dir, 'home');
  await mkdir(join(dir, 'data', 'config'), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(home, 'notes.txt'), 'buy bread\n');
  await writeFile(join(dir, 'data', 'config', 'global.json'), JSON.stringify({ backend: { mode: 'remote', url: server.url } }));
  const core = createCore({ dataDir: join(dir, 'data'), env: {}, home, logger: () => undefined });
  core.plugins.add(MANIFEST, { builtin: true });
  expect((await core.plugins.activate('notes', NOTES)).active).toBe(true);
  return { core, handler: createAgentHandler(core), prompts, home };
}

async function turn(handler: (request: Request) => Promise<Response>, query = '', extra: Record<string, unknown> = {}): Promise<Line[]> {
  const response = await handler(
    new Request(`${AGENT_ENDPOINT}/c/c1${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        v: 1,
        messageId: 'm1',
        request: { messages: [{ role: 'user', content: 'Go' }], modelId: '' },
        clientTools: [],
        ...extra,
      }),
    }),
  );
  return (await response.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Line);
}

const resolved = (lines: Line[]) => lines.filter((line) => line.type === 'tool-resolved').map((line) => String(line['result']));

// Several turns each: slow when the whole suite runs at once.
describe('the plugins inside the core', { timeout: 30_000 }, () => {
  it("a plugin's tool is told to the model and runs in a turn; what it reads is the conversation's", async () => {
    const { handler, prompts } = await setup('<|tool_call>call:count_notes{}<tool_call|>');
    const lines = await turn(handler);
    expect(prompts[0]).toContain('count_notes');
    expect(resolved(lines)).toEqual([expect.stringContaining('The notes say:')]);
    expect(resolved(lines)[0]).toContain('buy bread');
    expect(lines.at(-1)!.type).toBe('run-done');
  });

  it("what a plugin's tool writes is the conversation's mode's: in Répétition the person is asked, in Plume it is done", async () => {
    const asking = await setup('<|tool_call>call:stamp_notes{}<tool_call|>');
    const paused = (await turn(asking.handler)).at(-1)!;
    expect(paused.type).toBe('run-suspended');
    const pending = paused['pending'] as { toolCallId: string; name: string }[];
    expect(pending).toMatchObject([{ name: 'stamp_notes' }]);
    await expect(readFile(join(asking.home, 'stamp.txt'), 'utf8')).rejects.toThrow();
    // The person allows the plugin's write: it is done, in the perimeter.
    const outcomes = { [pending[0]!.toolCallId]: { kind: 'decision', approved: true } };
    await turn(asking.handler, '', { resume: { ticket: paused['ticket'], outcomes } });
    expect(await readFile(join(asking.home, 'stamp.txt'), 'utf8')).toBe('stamped\n');

    const passing = await setup('<|tool_call>call:stamp_notes{}<tool_call|>');
    await turn(passing.handler, '?mode=plume');
    expect(await readFile(join(passing.home, 'stamp.txt'), 'utf8')).toBe('stamped\n');
  });

  it('a project that turns the plugin off: its conversations are not told the tool, and a call to it is refused', async () => {
    const { core, handler, prompts, home } = await setup('<|tool_call>call:count_notes{}<tool_call|>');
    const project = await core.projects.create({ name: 'Maison', roots: [home] });
    await core.plugins.setEnabled('notes', false, { projectId: project.id });
    const lines = await turn(handler, `?project=${project.id}`);
    expect(prompts[0]).not.toContain('count_notes');
    expect(lines.filter((line) => line.type === 'tool-failed' || line.type === 'tool-rejected' || line.type === 'tool-resolved')).toHaveLength(1);
    expect(JSON.stringify(lines)).toContain('There is no tool named count_notes');
    expect(core.plugins.status().find((plugin) => plugin.id === 'notes')?.enabled).toBe(true);
  });
});

