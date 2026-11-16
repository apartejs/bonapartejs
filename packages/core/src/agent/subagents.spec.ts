/**
 * Sub-agents (task 8.1). The model hands a piece of work to a sub-agent
 * (`run_subagent`): it works with its own context, on the slot its
 * conversation lends it — the conversation saved before, restored after —
 * with the tools it was given, never more than the conversation may, and
 * only its result comes back to the conversation; its own thread is kept
 * apart. On the wire: `agent-start`, its events with its `agentId`, then
 * `agent-end`. A call it must ask about pauses the turn under its name;
 * refusing it stops only it: it reads the refusal and returns what it has.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlayMode } from '@aparte/bonaparte-shared';
import type { StreamRunEvent } from '@aparte/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore } from '../api.js';
import { LlamaCppHttpClient } from '../backend/llamacpp/http-client.js';
import { ConversationEngine, type TurnEvent } from '../conversation/engine.js';
import { ConversationStore } from '../conversation/store.js';
import { familyLayer } from '../families/index.js';
import { openJournal } from '../journal/journal.js';
import { KvStore, type LiveConfig } from '../kv/kv-store.js';
import { PermissionEngine } from '../permissions/engine.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';
import { builtinTools } from '../tools/builtin/index.js';
import { ToolRegistry } from '../tools/registry.js';
import { AGENT_ENDPOINT, createAgentHandler } from './handler.js';
import { runAgentTurn } from './loop.js';

let servers: FakeLlamaServer[] = [];
let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
  servers = [];
  dirs = [];
});

const Q = '<|"|>';
const LIVE: LiveConfig = { modelFingerprint: 'fp-gemma', nCtx: 8192, cacheTypeK: 'f16', cacheTypeV: 'f16' };
const AGENT_ID = /^agent-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function call(name: string, args: Record<string, string> = {}): string {
  return `<|tool_call>call:${name}{${Object.entries(args)
    .map(([key, value]) => `${key}:${Q}${value}${Q}`)
    .join(',')}}<tool_call|>`;
}

/** Has the model read a tool's answer since the last message of its turn? */
const answered = (prompt: string) => prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user');
const isSubagent = (prompt: string) => prompt.includes('You are a sub-agent');
/** The sub-agent's name, as its note tells it. */
const subagentName = (prompt: string) => /You are a sub-agent named ([^.]+)\./.exec(prompt)?.[1] ?? '';

const LECTEUR = { name: 'Lecteur', mission: 'Read a.ts and say what a is.', tools: 'read' };

/** The conversation hands `missions` to sub-agents (one step), then sums up; a sub-agent does `work`, then answers. */
function model(missions: Record<string, string>[], work: (name: string) => string = () => call('read_file', { path: 'a.ts' })) {
  return (prompt: string): string => {
    if (isSubagent(prompt)) {
      const name = subagentName(prompt);
      return answered(prompt) ? `Result of ${name}: a is 1.` : work(name);
    }
    return answered(prompt) ? 'Synthèse.' : missions.map((mission) => call('run_subagent', mission)).join('');
  };
}

/** A conversation engine on a managed engine (its memory kept), the loop over it, and what the slot saw. */
async function rig(responder: (prompt: string) => string, mode: PlayMode = 'plume') {
  const dir = await mkdtemp(join(tmpdir(), 'bp-subagents-'));
  dirs.push(dir);
  const root = join(dir, 'project');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
  const kvDir = join(dir, 'kv-slots');
  const order: string[] = [];
  const label = (filename: string) => (filename.startsWith('seed-') ? 'seed' : filename.includes('_agent-') ? 'sub-agent' : 'conversation');
  const server = await startFakeLlamaServer({
    slotDir: kvDir,
    responder,
    onCompletion: (body) => {
      const prompt = String(body['prompt']);
      order.push(`${isSubagent(prompt) ? `complete ${subagentName(prompt)}` : 'complete conversation'}${body['n_predict'] === 0 ? ' (read)' : ''}`);
    },
  });
  servers.push(server);
  const client = new LlamaCppHttpClient(server.url);
  const save = client.saveSlot.bind(client);
  const restore = client.restoreSlot.bind(client);
  client.saveSlot = async (slot, filename) => {
    order.push(`save ${label(filename)}`);
    return save(slot, filename);
  };
  client.restoreSlot = async (slot, filename, ...rest) => {
    order.push(`restore ${label(filename)}`);
    return restore(slot, filename, ...rest);
  };
  const store = new ConversationStore(join(dir, 'conversations'));
  const registry = new ToolRegistry();
  for (const tool of builtinTools()) registry.register(tool.def, tool.handler);
  const engine = new ConversationEngine({
    store,
    kv: new KvStore(kvDir),
    engine: async () => ({ client, family: familyLayer('gemma'), live: LIVE, modelPath: 'gemma.gguf', kvBytesPerToken: 100, generation: 1 }),
    prompt: () => ({ kind: 'code', tools: registry.list(), perimeter: [root], replyLanguage: 'French' }),
  });
  const meta = await store.create({ kind: 'code', engineId: 'builtin', modelId: 'gemma', mode });
  const permissions = new PermissionEngine({ roots: () => [root], dataDir: join(dir, 'data') });
  const run = async (text: string, signal = new AbortController().signal) => {
    const events: StreamRunEvent[] = [];
    const said: TurnEvent[] = [];
    const result = await runAgentTurn(
      {
        conversationId: meta.id,
        input: { text },
        mode,
        registry,
        permissions,
        conversations: engine,
        roots: [root],
        nCtx: 8192,
        ticket: (pending) => `ticket-${pending.length}`,
        signal,
      },
      (event) => events.push(event),
      (event) => said.push(event),
    );
    return { result, events, said };
  };
  return { dir, root, store, engine, meta, run, order };
}

const of = (events: StreamRunEvent[], type: StreamRunEvent['type']) => events.filter((event) => event.type === type) as Record<string, any>[];
const by = (events: StreamRunEvent[], agentId: string) => events.filter((event) => (event as { agentId?: string }).agentId === agentId);

describe('a sub-agent on the built-in engine', () => {
  it('works on the slot its conversation lends it: the conversation saved before, restored after', async () => {
    const { run, order } = await rig(model([LECTEUR]));
    await run('Que vaut a ?');
    const first = order.indexOf('complete conversation');
    const lent = order.indexOf('save conversation', first);
    const worked = order.indexOf('complete Lecteur', lent);
    const home = order.indexOf('restore conversation', worked);
    const summed = order.indexOf('complete conversation', home);
    expect([first, lent, worked, home, summed].every((at) => at >= 0)).toBe(true);
    expect(first < lent && lent < worked && worked < home && home < summed).toBe(true);
    // What the sub-agent leaves in the slot, once it is done, is worth nothing: never saved.
    expect(order).not.toContain('save sub-agent');
  });

  it('says itself on the wire: agent-start, its events under its agentId, then agent-end with its result', async () => {
    const { run } = await rig(model([LECTEUR]));
    const { events } = await run('Que vaut a ?');
    const [launch] = of(events, 'tool-start');
    expect(launch).toMatchObject({ name: 'run_subagent', input: LECTEUR });
    const [start] = of(events, 'agent-start');
    expect(start).toMatchObject({ name: 'Lecteur', description: LECTEUR.mission, toolCallId: launch!['toolCallId'] });
    const agentId = String(start!['agentId']);
    expect(agentId).toMatch(AGENT_ID);
    const mine = by(events, agentId).map((event) => event.type);
    expect(mine).toEqual(expect.arrayContaining(['tool-start', 'tool-resolved', 'text-delta']));
    expect(of(events, 'agent-end')).toEqual([expect.objectContaining({ agentId, status: 'done', result: 'Result of Lecteur: a is 1.' })]);
    // The sub-agent's call is its own, never a row of the reply.
    expect(of(events, 'tool-start').filter((event) => event['name'] === 'read_file')).toEqual([expect.objectContaining({ agentId })]);
    const resolved = of(events, 'tool-resolved').find((event) => event['toolCallId'] === launch!['toolCallId']);
    expect(resolved).toMatchObject({ result: 'Result of Lecteur: a is 1.' });
    expect(resolved!['agentId']).toBeUndefined();
  });

  it('only its result enters the conversation; its own thread is kept apart', async () => {
    const { run, store, meta, engine } = await rig(model([LECTEUR]));
    const { events } = await run('Que vaut a ?');
    const agentId = String(of(events, 'agent-start')[0]!['agentId']);
    const entries = (await openJournal(store.dir, meta.id)).entries();
    const results = entries.flatMap((entry) => (entry.kind === 'tool-results' ? entry.results : []));
    expect(results).toEqual([expect.objectContaining({ name: 'run_subagent', content: 'Result of Lecteur: a is 1.' })]);
    const thread = (await engine.subagentJournal(meta.id, agentId)).entries();
    expect(thread.map((entry) => entry.kind)).toEqual(expect.arrayContaining(['user', 'assistant', 'tool-results']));
    expect(thread.find((entry) => entry.kind === 'user')).toMatchObject({ text: LECTEUR.mission });
    expect(thread.flatMap((entry) => (entry.kind === 'tool-results' ? entry.results.map((result) => result.name) : []))).toEqual(['read_file']);
  });

  it('three sub-agents of one step pass one after another; those waiting say so, under their name', async () => {
    const missions = ['Un', 'Deux', 'Trois'].map((name) => ({ name, mission: `Lead ${name}.`, tools: 'read' }));
    const { run, order } = await rig(model(missions));
    const { events } = await run('Trois pistes.');
    const ids = of(events, 'agent-start').map((event) => String(event['agentId']));
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    // Announced together; the second and the third wait for the slot, and say it.
    for (const id of ids.slice(1)) {
      const mine = by(events, id);
      expect(mine.slice(0, 2)).toMatchObject([{ type: 'agent-start' }, { type: 'step-start', name: 'slot-wait' }]);
      expect(mine.findIndex((event) => event.type === 'step-end' && (event as { name?: string }).name === 'slot-wait')).toBeGreaterThan(0);
    }
    const ends = of(events, 'agent-end').map((event) => event['agentId']);
    expect(ends).toEqual(ids);
    // One after another in the one slot; the conversation saved once, restored once.
    const worked = order.filter((line) => line.startsWith('complete ') && !line.includes('conversation') && !line.endsWith('(read)'));
    expect(worked).toEqual(['complete Un', 'complete Un', 'complete Deux', 'complete Deux', 'complete Trois', 'complete Trois']);
    expect(order.filter((line) => line === 'save conversation')).toHaveLength(1);
    expect(order.filter((line) => line === 'restore conversation')).toHaveLength(1);
  });

  it('cannot launch a sub-agent of its own: run_subagent is not among its tools', async () => {
    const { run } = await rig(model([LECTEUR], () => call('run_subagent', { name: 'Petit', mission: 'Go.', tools: 'read' })));
    const { events } = await run('Que vaut a ?');
    const agentId = String(of(events, 'agent-start')[0]!['agentId']);
    expect(of(events, 'agent-start')).toHaveLength(1);
    const refused = by(events, agentId).find((event) => event.type === 'tool-rejected' || event.type === 'tool-failed');
    expect(refused).toBeDefined();
  });

  it('never more than its conversation: « read » leaves it no write, and Lecture refuses its writes whatever it was given', async () => {
    const edit = () => call('edit_file', { path: 'a.ts', old_string: '1', new_string: '2' });
    const reader = await rig(model([LECTEUR], edit), 'impro');
    const one = await reader.run('Lis.');
    const agentId = String(of(one.events, 'agent-start')[0]!['agentId']);
    expect(by(one.events, agentId).find((event) => event.type === 'tool-rejected' || event.type === 'tool-failed')).toBeDefined();
    expect(await readFile(join(reader.root, 'a.ts'), 'utf8')).toBe('export const a = 1;\n');

    const writer = await rig(model([{ ...LECTEUR, tools: 'all' }], edit), 'lecture');
    const two = await writer.run('Lis.');
    const other = String(of(two.events, 'agent-start')[0]!['agentId']);
    expect(by(two.events, other).find((event) => event.type === 'tool-rejected')).toMatchObject({ by: 'policy' });
    expect(await readFile(join(writer.root, 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
  });

  it('a call it must ask about pauses the turn under its name; its state is kept for the answer', async () => {
    const edit = () => call('edit_file', { path: 'a.ts', old_string: '1', new_string: '2' });
    const { run, order } = await rig(model([{ ...LECTEUR, tools: 'all' }], edit), 'repetition');
    const { events, result } = await run('Change a.');
    const agentId = String(of(events, 'agent-start')[0]!['agentId']);
    expect(result.suspended?.pending).toEqual([expect.objectContaining({ name: 'edit_file', reason: 'approval', agentId })]);
    expect(by(events, agentId).map((event) => event.type)).toContain('tool-awaiting-approval');
    expect(of(events, 'agent-end')).toEqual([expect.objectContaining({ agentId, status: 'waiting' })]);
    // The run_subagent call is not the page's to answer: it is not among the calls that wait.
    expect(result.suspended?.pending.map((pending) => pending.name)).not.toContain('run_subagent');
    // Its state stays in the slot until someone else sits there: then it is saved.
    expect(order).not.toContain('save sub-agent');
  });

  it('Stop stops the sub-agents too', async () => {
    const stop = new AbortController();
    const { run } = await rig((prompt) => {
      if (isSubagent(prompt)) {
        stop.abort();
        return 'Je commence…';
      }
      return answered(prompt) ? 'Synthèse.' : call('run_subagent', LECTEUR);
    });
    const { events, result } = await run('Que vaut a ?', stop.signal);
    expect(result.stopped).toBe('user');
    expect(of(events, 'agent-end')).toEqual([expect.objectContaining({ status: 'stopped' })]);
  });
});

/* ----------------------------------------------------------------------------------------------------------------
 * Through the core and its handler: the pause of a sub-agent is answered, and it goes on.
 * -------------------------------------------------------------------------------------------------------------- */

type Line = { type: string } & Record<string, any>;

async function core(responder: (prompt: string) => string, dataDir?: string) {
  const server = await startFakeLlamaServer({ responder });
  servers.push(server);
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), 'bp-subagents-core-')));
  if (!dataDir) dirs.push(dir);
  const home = join(dir, 'project');
  await mkdir(home, { recursive: true });
  await writeFile(join(home, 'a.ts'), 'export const a = 1;\n').catch(() => undefined);
  await mkdir(join(dir, 'data', 'config'), { recursive: true });
  await writeFile(join(dir, 'data', 'config', 'global.json'), JSON.stringify({ backend: { mode: 'remote', url: server.url } }));
  const made = createCore({ dataDir: join(dir, 'data'), env: {}, logger: () => undefined, home });
  return { core: made, handler: createAgentHandler(made), dir, home };
}

async function post(handler: (request: Request) => Promise<Response>, body: Record<string, unknown> = {}): Promise<Line[]> {
  const response = await handler(
    new Request(`${AGENT_ENDPOINT}/c/c1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, messageId: 'm1', request: { messages: [{ role: 'user', content: 'Change a.' }], modelId: '' }, clientTools: [], ...body }),
    }),
  );
  return (await response.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Line);
}

const EDITOR = { name: 'Rédacteur', mission: 'Set a to 2 in a.ts.', tools: 'all' };
const editing = () => call('edit_file', { path: 'a.ts', old_string: '1', new_string: '2' });

describe('a sub-agent that waits for the person', () => {
  it('approved: its call runs, it finishes, and the conversation goes on with its result', async () => {
    const { handler, home } = await core(model([EDITOR], editing));
    const first = await post(handler);
    const ended = first.at(-1)!;
    expect(ended.type).toBe('run-suspended');
    const [waits] = ended['pending'] as { toolCallId: string; agentId: string }[];
    const resumed = await post(handler, { resume: { ticket: ended['ticket'], outcomes: { [waits!.toolCallId]: { kind: 'decision', approved: true } } } });
    expect(await readFile(join(home, 'a.ts'), 'utf8')).toBe('export const a = 2;\n');
    // The same sub-agent goes on: its line, its end, then the conversation's answer.
    expect(resumed.filter((line) => line['agentId'] === waits!.agentId).map((line) => line.type)).toEqual(
      expect.arrayContaining(['tool-approved', 'tool-resolved', 'agent-end']),
    );
    expect(resumed.find((line) => line.type === 'agent-end')).toMatchObject({ status: 'done', result: 'Result of Rédacteur: a is 1.' });
    expect(resumed.filter((line) => line.type === 'text-delta' && !line['agentId']).map((line) => line['delta']).join('')).toBe('Synthèse.');
    expect(resumed.at(-1)!.type).toBe('run-done');
  });

  it('refused: only it stops — it reads the refusal and returns what it has; the conversation goes on', async () => {
    const two = [EDITOR, { name: 'Lecteur', mission: 'Read a.ts.', tools: 'read' }];
    const { handler, home } = await core(model(two, (name) => (name === 'Rédacteur' ? editing() : call('read_file', { path: 'a.ts' }))));
    const ended = (await post(handler)).at(-1)!;
    const pending = ended['pending'] as { toolCallId: string; name: string; reason: string; agentId?: string }[];
    expect(pending.map((call) => [call.name, call.reason, Boolean(call.agentId)])).toEqual([
      ['edit_file', 'approval', true],
      ['run_subagent', 'queued', false],
    ]);
    const resumed = await post(handler, {
      resume: { ticket: ended['ticket'], outcomes: { [pending[0]!.toolCallId]: { kind: 'decision', approved: false } } },
    });
    expect(await readFile(join(home, 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
    const refused = resumed.find((line) => line.type === 'tool-rejected');
    expect(refused).toMatchObject({ agentId: pending[0]!.agentId, by: 'person' });
    // The refused sub-agent returns what it has; the next one is not refused for it: it runs.
    const ends = resumed.filter((line) => line.type === 'agent-end');
    expect(ends.map((line) => line['status'])).toEqual(['done', 'done']);
    expect(resumed.filter((line) => line.type === 'tool-rejected' && line['by'] === 'earlier-refusal')).toEqual([]);
    expect(resumed.at(-1)!.type).toBe('run-done');
  });

  it('its pause survives a restart: a new core on the same folder resumes it, under the same agentId', async () => {
    const first = await core(model([EDITOR], editing));
    const ended = (await post(first.handler)).at(-1)!;
    const [waits] = ended['pending'] as { toolCallId: string; agentId: string }[];
    const again = await core(model([EDITOR], editing), first.dir);
    const resumed = await post(again.handler, { resume: { ticket: ended['ticket'], outcomes: { [waits!.toolCallId]: { kind: 'decision', approved: true } } } });
    expect(await readFile(join(again.home, 'a.ts'), 'utf8')).toBe('export const a = 2;\n');
    expect(resumed.find((line) => line.type === 'agent-end')).toMatchObject({ agentId: waits!.agentId, status: 'done' });
  });

  it('agent ids never repeat from one request to the next', async () => {
    const { handler } = await core(model([LECTEUR]));
    const one = await post(handler);
    const two = await post(handler, { messageId: 'm2', request: { messages: [{ role: 'user', content: 'Change a.' }, { role: 'assistant', content: 'Synthèse.' }, { role: 'user', content: 'Encore.' }], modelId: '' } });
    const ids = [...one, ...two].filter((line) => line.type === 'agent-start').map((line) => line['agentId']);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
