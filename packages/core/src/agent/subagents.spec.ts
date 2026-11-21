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
import { runQueuedSubagent } from './subagents.js';

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
async function rig(
  responder: (prompt: string) => string,
  mode: PlayMode = 'plume',
  options: { slots?: number; paceMs?: number; nCtx?: number; thinkingChars?: number; maxToolRounds?: number; instructions?: string } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'bp-subagents-'));
  dirs.push(dir);
  const root = join(dir, 'project');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
  const kvDir = join(dir, 'kv-slots');
  const order: string[] = [];
  /** Which slot each sub-agent's completions ran on. */
  const placed: [string, unknown][] = [];
  /** The tool grammar each sub-agent's completion was given. */
  const grammars: string[] = [];
  /** Each completion a sub-agent asked: whether it could call a tool, and its prompt. */
  const asked: { grammar: boolean; prompt: string }[] = [];
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
      if (isSubagent(prompt) && typeof body['grammar'] === 'string') grammars.push(body['grammar']);
      if (isSubagent(prompt) && body['n_predict'] !== 0) asked.push({ grammar: typeof body['grammar'] === 'string', prompt });
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
    ...(options.thinkingChars ? { subagentThinkingChars: options.thinkingChars } : {}),
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
    ...(options.instructions !== undefined ? { instructions: async () => options.instructions } : {}),
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
        ...(options.maxToolRounds ? { maxToolRounds: options.maxToolRounds } : {}),
      },
      (event) => events.push(event),
      (event) => said.push(event),
    );
    return { result, events, said };
  };
  return { dir, root, store, engine, meta, run, order, placed, grammars, asked, registry, permissions };
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

  it('« read » and a call to write_file: never twisted into another tool — refused in words it can act on', async () => {
    const write = () => call('write_file', { path: 'index.html', content: '<p>hi</p>' });
    const { run, grammars, root } = await rig(model([LECTEUR], write), 'impro');
    const { events } = await run('Écris index.html.');
    const agentId = String(of(events, 'agent-start')[0]!['agentId']);
    // Its prompt shows the conversation's whole inventory: its grammar admits every name it may read there, so a
    // call it means is written as it means it, never bent into the nearest name it may use (browser_read).
    expect(grammars.length).toBeGreaterThan(0);
    for (const grammar of grammars) expect(grammar).toContain('write_file');
    const failed = by(events, agentId).find((event) => event.type === 'tool-failed' || event.type === 'tool-resolved') as Record<string, unknown>;
    expect(String(failed['error'] ?? failed['result'])).toMatch(/write_file is not yours: this sub-agent reads and searches only/);
    expect(String(failed['error'] ?? failed['result'])).toMatch(/answer the main agent/);
    // Nothing written: the file it meant to write is not there.
    await expect(readFile(join(root, 'index.html'), 'utf8')).rejects.toThrow();
  });

  it('the same call failing three times in a row stops it, and the main agent reads why — never 25 rounds of it', async () => {
    // A sub-agent that never learns: the same call, whatever it reads back.
    const stuck = model([LECTEUR]);
    const { run, order } = await rig((prompt) => (isSubagent(prompt) ? call('read_file', { path: 'missing.txt' }) : stuck(prompt)), 'impro');
    const { events } = await run('Lis la page.');
    const agentId = String(of(events, 'agent-start')[0]!['agentId']);
    expect(order.filter((line) => line === 'complete Lecteur')).toHaveLength(3);
    const [end] = of(events, 'agent-end');
    expect(end).toMatchObject({ agentId, status: 'failed' });
    expect(String(end!['error'])).toMatch(/stopped: it called read_file the same way 3 times in a row, and it failed each time/);
    expect(String(end!['error'])).toMatch(/missing.txt/);
    // The conversation goes on with what it learnt.
    const launch = of(events, 'tool-start').find((event) => event['name'] === 'run_subagent')!;
    const outcome = events.find(
      (event) => (event.type === 'tool-resolved' || event.type === 'tool-failed') && (event as { toolCallId?: string }).toolCallId === launch['toolCallId'],
    ) as Record<string, unknown>;
    expect(String(outcome['result'] ?? outcome['error'])).toMatch(/same way 3 times/);
  });

  it('stopped on a refusal, it tells the main agent what it tried — never the words meant for the sub-agent', async () => {
    const main = model([LECTEUR]);
    const { run } = await rig((prompt) => (isSubagent(prompt) ? call('write_file', { path: 'index.html', content: 'x' }) : main(prompt)), 'impro');
    const { events } = await run('Écris index.html.');
    const error = String(of(events, 'agent-end')[0]!['error']);
    expect(error).toMatch(/it called write_file the same way 3 times/);
    expect(error).toMatch(/reads and searches only/);
    expect(error).not.toMatch(/Do not call write_file again/);
  });

  it('a tool no sub-agent has is refused as such, whatever tools it was given', async () => {
    const { run } = await rig(model([LECTEUR], () => call('run_subagent', { name: 'Petit', mission: 'Go.', tools: 'read' })), 'impro');
    const { events } = await run('Que vaut a ?');
    const agentId = String(of(events, 'agent-start')[0]!['agentId']);
    const refused = by(events, agentId).find((event) => event.type === 'tool-failed') as Record<string, unknown>;
    expect(String(refused['error'])).toMatch(/run_subagent is not for a sub-agent/);
    expect(of(events, 'agent-start')).toHaveLength(1);
  });

  it('a reasoning that runs past its cap without acting stops it, said to the main agent — never the whole context', async () => {
    const musing = `<|channel>thought\n${'Je réfléchis encore. '.repeat(200)}`;
    const main = model([LECTEUR]);
    const { run } = await rig((prompt) => (isSubagent(prompt) ? musing : main(prompt)), 'impro', { thinkingChars: 500 });
    const { events } = await run('Réfléchis.');
    const agentId = String(of(events, 'agent-start')[0]!['agentId']);
    const thought = by(events, agentId)
      .filter((event) => event.type === 'thinking-delta')
      .map((event) => (event as { delta: string }).delta)
      .join('');
    // Cut once past the cap: what was shown is about the cap, never the 4,000 characters it would have written.
    expect(thought.length).toBeGreaterThan(400);
    expect(thought.length).toBeLessThan(1500);
    const [end] = of(events, 'agent-end');
    expect(end).toMatchObject({ agentId, status: 'failed' });
    expect(String(end!['error'])).toMatch(/its reasoning ran past 500 characters without acting/);
  });

  it('its limit of rounds reached, it is given one last answer without tools, and the main agent reads it as cut — never « done » (audit S4)', async () => {
    const main = model([LECTEUR]);
    const { run, asked } = await rig(
      (prompt) => {
        if (!isSubagent(prompt)) return main(prompt);
        return prompt.includes('You reached your limit') ? 'Partial: a is 1; b.ts not read.' : call('read_file', { path: 'a.ts' });
      },
      'impro',
      { maxToolRounds: 3 },
    );
    const { events } = await run('Lis tout.');
    // Three rounds with its tools, then one answer that can call none.
    expect(asked.map((one) => one.grammar)).toEqual([true, true, true, false]);
    expect(asked.at(-1)!.prompt).toContain('You reached your limit of 3 rounds of tools: answer now with what you found, and say what is left.');
    const [end] = of(events, 'agent-end');
    expect(end!['status']).not.toBe('done');
    expect(end).toMatchObject({ status: 'stopped' });
    const launch = of(events, 'tool-start').find((event) => event['name'] === 'run_subagent')!;
    const outcome = of(events, 'tool-resolved').find((event) => event['toolCallId'] === launch['toolCallId'])!;
    expect(String(outcome['result'])).toMatch(/^The sub-agent was cut after 3 rounds of tools, before it finished\./);
    expect(String(outcome['result'])).toContain('Partial: a is 1; b.ts not read.');
  });

  describe('what it reads (audit S2)', () => {
    it('its conversation’s own turn after the shared one — the project’s instructions as the conversation froze them: their prefix grows', async () => {
      const { run, store, meta, asked } = await rig(model([LECTEUR]), 'plume', { instructions: 'Never write a shell string. Tests first.' });
      await run('Que vaut a ?');
      const systems = (await openJournal(store.dir, meta.id)).entries().filter((entry) => entry.kind === 'system');
      const [shared, project] = systems.map((entry) => entry.rendered ?? '');
      expect(project).toContain('Never write a shell string. Tests first.');
      expect(asked[0]!.prompt.startsWith(shared! + project!)).toBe(true);
    });

    it('its note: no context but its mission, its tools, its mode in a line, never ask, never retry, the answer then the evidence — never « nobody reads »', async () => {
      const { run, asked } = await rig(model([LECTEUR]), 'repetition');
      await run('Que vaut a ?');
      const prompt = asked[0]!.prompt;
      expect(prompt).toContain('You are a sub-agent named Lecteur. You start with no context: the mission below is all you know');
      expect(prompt).toMatch(/Use only these tools: [a-z_, ]*read_file/);
      expect(prompt).toContain('Mode: Répétition: each change to a file and each command is asked to the user first');
      expect(prompt).toContain('Never ask the user anything. If a call is refused, do not retry it.');
      expect(prompt).toContain('give the answer first, then the evidence (paths with line numbers). If you could not finish, say what is left.');
      expect(prompt).not.toMatch(/nobody else reads/);
    });

    it('in Lecture, its refused write tells it to hand back what it would write — never to present a plan with update_plan', async () => {
      const edit = () => call('edit_file', { path: 'a.ts', old_string: '1', new_string: '2' });
      const { run } = await rig(model([{ ...LECTEUR, tools: 'all' }], edit), 'lecture');
      const { events } = await run('Lis.');
      const agentId = String(of(events, 'agent-start')[0]!['agentId']);
      const refused = by(events, agentId).find((event) => event.type === 'tool-rejected') as Record<string, unknown>;
      expect(String(refused['reason'])).toMatch(/a sub-agent writes nothing\. Do not try again: answer the main agent/);
      expect(String(refused['reason'])).not.toMatch(/update_plan/);
    });

    it('a tool come after its conversation froze its inventory: told with its description, not only its name', async () => {
      const made = await rig(model([LECTEUR]));
      await made.run('Bonjour.');
      made.registry.register(
        { name: 'mcp__docs__lookup', description: 'Look a word up in the project glossary.', inputSchema: { type: 'object', properties: { word: { type: 'string' } } }, effect: 'read', source: 'mcp', where: 'core' },
        async (call) => ({ toolCallId: call.id, name: call.name, content: 'x' }),
      );
      made.asked.length = 0;
      await made.run('Que vaut a ?');
      expect(made.asked[0]!.prompt).toMatch(/Your tools added after the list above:\n- mcp__docs__lookup: Look a word up in the project glossary\./);
    });
  });

  describe('its own context (audit S5)', () => {
    const BIG = { name: 'Lecteur', mission: 'Read big.ts and say what it holds.', tools: 'read' };
    /** A sub-agent run alone (as one queued behind a pause), its conversation capped to `cap` tokens over what it starts with. */
    async function alone(cap: (start: number) => number, mission = BIG.mission, maxToolRounds?: number) {
      const responder = (prompt: string): string => {
        if (!isSubagent(prompt)) return 'Bonjour.';
        if (prompt.includes('Your context is nearly full')) return 'Partial: big.ts holds x.';
        // It reads big.ts twice (about 2,000 tokens each time), then answers.
        return prompt.split('<|tool_response>').length > 2 ? 'Whole: big.ts holds x.' : call('read_file', { path: 'big.ts' });
      };
      const made = await rig(responder, 'impro', maxToolRounds ? { maxToolRounds } : {});
      await writeFile(join(made.root, 'big.ts'), `export const x = '${'x'.repeat(6000)}';\n`);
      // Its conversation's prompt frozen: what the sub-agent's starts with, as on a real turn.
      await made.run('Bonjour.');
      const parent = (events: StreamRunEvent[]) => ({
        conversationId: made.meta.id,
        mode: 'impro' as const,
        registry: made.registry,
        permissions: made.permissions,
        place: { roots: [made.root] },
        nCtx: 8192,
        ...(maxToolRounds ? { maxToolRounds } : {}),
        signal: new AbortController().signal,
        engine: made.engine,
        emit: (event: StreamRunEvent) => events.push(event),
      });
      const queued = (id: string, input: Record<string, string>) => ({ toolCallId: id, name: 'run_subagent', input, reason: 'queued' as const });
      // What its first prompt holds, as the engine counts it: a probe of the same note and mission.
      const probe: StreamRunEvent[] = [];
      await runQueuedSubagent(parent(probe), queued('probe', { ...BIG, mission }));
      const probeId = String(of(probe, 'agent-start')[0]!['agentId']);
      const first = (await made.engine.subagentJournal(made.meta.id, probeId)).entries().find((entry) => entry.kind === 'assistant');
      const start = (first?.kind === 'assistant' && first.usage?.contextTokens) || 0;
      await made.store.settle(made.meta.id, { contextCap: cap(start) });
      made.asked.length = 0;
      const events: StreamRunEvent[] = [];
      const end = await runQueuedSubagent(parent(events), queued('real', { ...BIG, mission }));
      return { end, events, asked: made.asked };
    }

    it('results that would fill most of it: shown, then its last answer without tools — the main agent reads it as cut', async () => {
      // About 2,000 tokens of results each time over 4,700 of room (the engine counts the first at 1,500): the second read passes 80 %, yet leaves room.
      const { end, asked } = await alone((start) => start + 4700);
      expect(asked.map((one) => one.grammar)).toEqual([true, true, false]);
      expect(asked[1]!.prompt).not.toContain('Your context is nearly full');
      expect(asked[2]!.prompt.split('xxxxxxxxxx').length).toBeGreaterThan(2);
      expect(asked[2]!.prompt).toContain('Your context is nearly full: answer now with what you found');
      expect(end.kind).toBe('partial');
      expect('result' in end && end.result).toMatch(/^The sub-agent was cut when its own context \(\d+ tokens\) was nearly full, before it finished\./);
      expect('result' in end && end.result).toContain('Partial: big.ts holds x.');
    });

    it('results that would leave it no room to answer: not shown, and it answers with what it has', async () => {
      const { end, asked } = await alone((start) => start + 2500);
      expect(asked.map((one) => one.grammar)).toEqual([true, false]);
      expect(asked[1]!.prompt).not.toContain('xxxxxxxxxx');
      expect(asked[1]!.prompt).toContain('Not shown: your context has no room left for it.');
      expect(end.kind).toBe('partial');
    });

    it('its last round by the limit of rounds, with results that would leave no room: not shown either — never an overflow that loses what it found (review of S4, S5)', async () => {
      const { end, asked } = await alone((start) => start + 2500, BIG.mission, 1);
      expect(asked.map((one) => one.grammar)).toEqual([true, false]);
      expect(asked[1]!.prompt).not.toContain('xxxxxxxxxx');
      expect(asked[1]!.prompt).toContain('Not shown: your context has no room left for it.');
      // Its why stays the limit of rounds.
      expect(asked[1]!.prompt).toContain('You reached your limit of 1 rounds of tools');
      expect(end.kind).toBe('partial');
      expect('result' in end && end.result).toMatch(/^The sub-agent was cut after 1 rounds of tools/);
    });

    it('its note says its budget', async () => {
      const { asked } = await alone(() => 8192);
      expect(asked[0]!.prompt).toMatch(/Your context holds \d+ tokens; this prompt takes about \d+ of them\./);
    });

    it('a mission its context cannot hold: said as its own context, never « the conversation »', async () => {
      const { end } = await alone(() => 8192, `Read big.ts. ${'Context. '.repeat(3000)}`);
      expect(end.kind).toBe('failed');
      expect('result' in end && end.result).toMatch(/^The sub-agent's own context \(8192 tokens\) filled up/);
      expect('result' in end && end.result).not.toMatch(/conversation is full/);
    });
  });

  it('the tool says when to give a sub-agent all its tools: a mission that writes a file or runs a command', () => {
    const def = builtinTools().find((tool) => tool.def.name === 'run_subagent')!.def;
    const tools = (def.inputSchema as { properties: Record<string, { description: string }> }).properties['tools']!;
    expect(tools.description).toMatch(/"all".*writes a file or runs a command/);
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
    // Its answer after the pause is a turn of its own: never added to the blocks it settled before it.
    const mine = resumed.filter((line) => line['agentId'] === waits!.agentId).map((line) => line.type);
    const restart = mine.indexOf('turn-start');
    expect(restart).toBeGreaterThan(mine.indexOf('tool-resolved'));
    expect(restart).toBeLessThan(mine.indexOf('text-delta'));
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
