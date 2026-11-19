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
async function rig(responder: (prompt: string) => string, mode: PlayMode = 'plume', options: { slots?: number; paceMs?: number; nCtx?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bp-subagents-'));
  dirs.push(dir);
  const root = join(dir, 'project');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
  const kvDir = join(dir, 'kv-slots');
  const order: string[] = [];
  /** Which slot each sub-agent's completions ran on. */
  const placed: [string, unknown][] = [];
  const label = (filename: string) => (filename.startsWith('seed-') ? 'seed' : filename.includes('_agent-') ? 'sub-agent' : 'conversation');
  const server = await startFakeLlamaServer({
    slotDir: kvDir,
    responder,
    ...(options.slots ? { totalSlots: options.slots } : {}),
    ...(options.paceMs ? { paceMs: options.paceMs } : {}),
    ...(options.nCtx ? { nCtx: options.nCtx } : {}),
    onCompletion: (body) => {
      const prompt = String(body['prompt']);
      order.push(`${isSubagent(prompt) ? `complete ${subagentName(prompt)}` : 'complete conversation'}${body['n_predict'] === 0 ? ' (read)' : ''}`);
      if (isSubagent(prompt) && body['n_predict'] !== 0) placed.push([subagentName(prompt), body['id_slot']]);
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
    ...(options.slots ? { slots: options.slots } : {}),
    engine: async () => ({
      client,
      family: familyLayer('gemma'),
      live: LIVE,
      modelPath: 'gemma.gguf',
      kvBytesPerToken: 100,
      generation: 1,
      ...(options.slots ? { slots: options.slots } : {}),
    }),
    prompt: () => ({ kind: 'code', tools: registry.list(), perimeter: [root], replyLanguage: 'French' }),
  });
  const meta = await store.create({ kind: 'code', engineId: 'builtin', modelId: 'gemma', mode });
  const permissions = new PermissionEngine({ roots: () => [root], dataDir: join(dir, 'data') });
  const run = async (text: string, signal = new AbortController().signal, conversationId = meta.id) => {
    const events: StreamRunEvent[] = [];
    const said: TurnEvent[] = [];
    const result = await runAgentTurn(
      {
        conversationId,
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
  return { dir, root, store, engine, meta, run, order, placed };
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

  it('each of its calls to the model begins a turn under its agentId: its thoughts of two rounds are two blocks', async () => {
    const { run } = await rig(
      model([LECTEUR], () => `<|channel>thought\nfirst look<channel|>${call('read_file', { path: 'a.ts' })}`),
    );
    const { events } = await run('Que vaut a ?');
    const agentId = String(of(events, 'agent-start')[0]!['agentId']);
    const mine = by(events, agentId);
    const kinds = mine.map((event) => event.type);
    // Its first call opens with its agent-start; the call after its tool is a new turn.
    expect(kinds.filter((kind) => kind === 'turn-start')).toHaveLength(1);
    expect(kinds.indexOf('turn-start')).toBeGreaterThan(kinds.indexOf('tool-resolved'));
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

  it('while it works, the engine says who: its name, and nobody once it is done (the card « Occupé : sous-agent … »)', async () => {
    const seen: (string | null)[] = [];
    const box: { engine?: ConversationEngine } = {};
    const answer = model([LECTEUR]);
    const made = await rig((prompt) => {
      seen.push(box.engine!.subagentAtWork);
      return answer(prompt);
    });
    const engine = (box.engine = made.engine);
    const changes: (string | null)[] = [];
    made.engine.onSubagentAtWork((name) => changes.push(name));
    await made.run('Que vaut a ?');
    // The conversation's own completions, then the sub-agent's two, then the conversation's last.
    expect(seen.filter((name) => name !== null)).toEqual(['Lecteur', 'Lecteur']);
    expect(engine.subagentAtWork).toBeNull();
    expect(changes).toEqual(['Lecteur', null]);
  });

  it('in parallel (two slots, task 8.3), two sub-agents of a step work at the same time: nobody waits for the slot', async () => {
    const missions = ['Un', 'Deux'].map((name) => ({ name, mission: `Lead ${name}.`, tools: 'read' }));
    const { run, placed } = await rig(model(missions), 'plume', { slots: 2, paceMs: 15 });
    const { events } = await run('Deux pistes.');
    // Each on a slot of its own — the first on the one the turn lends, the second on the other — and nobody
    // waited for one: they worked together. (Judged by where, not when: a loaded machine reorders the when.)
    const slotsOf = (who: string) => [...new Set(placed.filter(([name]) => name === who).map(([, slot]) => slot))];
    expect(slotsOf('Un')).toHaveLength(1);
    expect(slotsOf('Deux')).toHaveLength(1);
    expect(slotsOf('Un')[0]).not.toBe(slotsOf('Deux')[0]);
    expect(events.filter((event) => event.type === 'step-start' && (event as { name?: string }).name === 'slot-wait')).toEqual([]);
    expect(of(events, 'agent-end').map((event) => event['status'])).toEqual(['done', 'done']);
    // Their results, in the order the model wrote the calls.
    expect(of(events, 'tool-resolved').filter((event) => !event['agentId']).map((event) => event['result'])).toEqual([
      'Result of Un: a is 1.',
      'Result of Deux: a is 1.',
    ]);
  });

  it('in parallel, two conversations that each hand two leads at once both end: a turn never waits for a slot while it holds one', async () => {
    const missions = ['Un', 'Deux'].map((name) => ({ name, mission: `Lead ${name}.`, tools: 'read' }));
    const { run, store } = await rig(model(missions), 'plume', { slots: 2, paceMs: 20 });
    const other = await store.create({ kind: 'code', engineId: 'builtin', modelId: 'gemma', mode: 'plume' });
    const both = Promise.all([run('Deux pistes.'), run('Deux pistes.', new AbortController().signal, other.id)]);
    const outcome = await Promise.race([both.then(() => 'done'), new Promise((resolve) => setTimeout(() => resolve('hung'), 15_000))]);
    expect(outcome).toBe('done');
    for (const { events } of await both) {
      expect(of(events, 'agent-end').map((event) => event['status'])).toEqual(['done', 'done']);
    }
  });

  it('a sub-agent the engine refuses (its prompt grew too long) fails — and its state, worth nothing, is never saved (review of phase 8)', async () => {
    const lead = { name: 'Lecteur', mission: 'Read big.ts and tell what it holds.', tools: 'read' };
    const responder = (prompt: string): string => {
      if (isSubagent(prompt)) return answered(prompt) ? 'It holds x.' : call('read_file', { path: 'big.ts' });
      return answered(prompt) ? 'Synthèse.' : call('run_subagent', lead);
    };
    // How long the conversation's prompt is: the server holds that, and a few hundred tokens more.
    const measure = await rig(() => 'ok');
    const prompt = (await measure.run('Lis big.ts.')).result.usage.inputTokens;
    const { run, root, order } = await rig(responder, 'plume', { nCtx: prompt + 600 });
    await writeFile(join(root, 'big.ts'), `export const x = '${'x'.repeat(6000)}';\n`);
    const { events } = await run('Lis big.ts.');
    expect(of(events, 'agent-end').map((event) => event['status'])).toEqual(['failed']);
    expect(order).toContain('complete Lecteur');
    expect(order.filter((line) => line === 'save sub-agent')).toEqual([]);
  });

  it('a sub-agent on a slot of its own (one resumed) that ends while another owner waits for it: its state is never saved (review of phase 8)', async () => {
    const { engine, store, meta, order } = await rig((prompt) => (isSubagent(prompt) ? `Done ${'and done '.repeat(30)}` : 'Hello.'), 'plume', { paceMs: 10 });
    const other = await store.create({ kind: 'code', engineId: 'builtin', modelId: 'gemma', mode: 'plume' });
    const solo = engine.subagentTurn(
      meta.id,
      { agentId: 'agent-1111', name: 'Solo' },
      { start: { note: 'You are a sub-agent named Solo.', mission: 'Say done.' }, tools: { defs: [], onCalls: async () => ({ results: [] }) } },
      () => undefined,
    );
    // Another conversation's turn arrives while the sub-agent holds the only slot: it waits for it.
    await new Promise((resolve) => setTimeout(resolve, 40));
    const turn = engine.turn(other.id, { text: 'Hi.' }, () => undefined);
    await Promise.all([solo, turn]);
    expect(order).toContain('complete Solo');
    expect(order.filter((line) => line === 'save sub-agent')).toEqual([]);
  });

  it('a pause of a sub-agent the person leaves for a new message: the conversation reads its run_subagent call answered — never a call it did not make — and the sub-agent is let go (review of phase 8)', async () => {
    const lead = { name: 'Mesureur', mission: 'Change a.ts.', tools: 'all' };
    const responder = (prompt: string): string => {
      if (isSubagent(prompt)) return call('edit_file', { path: 'a.ts', old_string: 'a = 1', new_string: 'a = 2' });
      return answered(prompt) ? 'Compris.' : call('run_subagent', lead);
    };
    const { run, store, meta, dir } = await rig(responder, 'repetition');
    const first = await run('Change a.ts par un sous-agent.');
    expect(first.result.suspended?.pending).toEqual([expect.objectContaining({ name: 'edit_file', reason: 'approval' })]);
    // The person does not answer: a new message.
    await run('Laisse tomber, autre chose.');
    const entries = (await openJournal(store.dir, meta.id)).entries();
    const closed = entries.find((entry) => entry.kind === 'tool-results' && entry.results.some((result) => result.content.startsWith('Not run') || result.content.startsWith('Stopped')));
    expect(closed?.kind === 'tool-results' && closed.results.map((result) => result.name)).toEqual(['run_subagent']);
    const { readdir } = await import('node:fs/promises');
    expect((await readdir(join(dir, 'kv-slots'))).filter((file) => file.includes('_agent-'))).toEqual([]);
  });

  it('in parallel, one that ends while one called before it waits: its result waits with the pause — results enter the prompt in the order of the calls (review of phase 8)', async () => {
    const missions = [
      { name: 'Un', mission: 'Change a.ts.', tools: 'all' },
      { name: 'Deux', mission: 'Read a.ts.', tools: 'read' },
    ];
    const responder = (prompt: string): string => {
      if (isSubagent(prompt)) {
        const who = subagentName(prompt);
        if (answered(prompt)) return `Result of ${who}.`;
        return who === 'Un' ? call('edit_file', { path: 'a.ts', old_string: 'a = 1', new_string: 'a = 2' }) : call('read_file', { path: 'a.ts' });
      }
      return answered(prompt) ? 'Synthèse.' : missions.map((mission) => call('run_subagent', mission)).join('');
    };
    const { run, store, meta } = await rig(responder, 'repetition', { slots: 2, paceMs: 10 });
    const { result } = await run('Deux pistes.');
    expect(result.suspended?.pending.map((pending) => pending.name)).toEqual(['edit_file']);
    const entries = (await openJournal(store.dir, meta.id)).entries();
    expect(entries.some((entry) => entry.kind === 'tool-results' && entry.results.some((one) => one.name === 'run_subagent'))).toBe(false);
    const pause = entries.findLast((entry) => entry.kind === 'pending');
    expect(pause?.kind === 'pending' && pause.subagents?.map((hold) => [(hold.input as { name: string }).name, hold.result?.kind ?? null])).toEqual([
      ['Un', null],
      ['Deux', 'done'],
    ]);
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
