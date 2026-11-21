/**
 * Sub-agents on a service (audit S1, S3). « Moteur des sous-agents » names a service the person added and one of
 * its models: the sub-agents of a conversation on the built-in engine run there — no slot taken, the core's tools
 * and its policy in the conversation's mode, their pause the conversation's, their line naming the model. A
 * conversation that itself runs on a service runs its sub-agents on that same service and model.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, type Core, type EngineState } from '../api.js';
import { openJournal } from '../journal/journal.js';
import type { SecretStore } from '../providers/secrets.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';
import { startFakeOpenAIServer, type FakeChatRequest, type FakeOpenAIAnswer, type FakeOpenAIServer } from '../testing/fake-openai-server.js';
import { AGENT_ENDPOINT, createAgentHandler } from './handler.js';
import { ASK_REFUSED, messagesOf, readSubagentsEngine } from './service-subagent.js';

const dirs: string[] = [];
const cores: Core[] = [];
const servers: (FakeLlamaServer | FakeOpenAIServer)[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop().catch(() => undefined);
  for (const server of servers.splice(0)) await server.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined);
});

const Q = '<|"|>';
const call = (name: string, args: Record<string, string>): string =>
  `<|tool_call>call:${name}{${Object.entries(args)
    .map(([key, value]) => `${key}:${Q}${value}${Q}`)
    .join(',')}}<tool_call|>`;
const answered = (prompt: string) => prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user');

const vault = (): SecretStore => {
  const held = new Map<string, string>();
  return {
    get: async (n) => held.get(n),
    set: async (n, v) => void held.set(n, v),
    delete: async (n) => void held.delete(n),
    has: async (n) => held.has(n),
  };
};

type Line = { type: string } & Record<string, any>;
const LECTEUR = { name: 'Lecteur', mission: 'Read a.ts and say what a is.', tools: 'read' };
const REDACTEUR = { name: 'Rédacteur', mission: 'Set a to 2 in a.ts.', tools: 'all' };

/** Is this request a sub-agent's (its note in its system message)? */
const isSubagent = (request: FakeChatRequest) => String(request.messages[0]?.content ?? '').includes('You are a sub-agent named');
const hasResults = (request: FakeChatRequest) => request.messages.some((message) => message.role === 'tool');

/** A sub-agent on the service: it reads a.ts (or does `work`), then gives its result. */
function serviceModel(work: FakeOpenAIAnswer = { calls: [{ name: 'read_file', arguments: { path: 'a.ts' } }] }, main?: (request: FakeChatRequest) => FakeOpenAIAnswer) {
  return (request: FakeChatRequest): FakeOpenAIAnswer => {
    if (!isSubagent(request)) return main?.(request) ?? { text: 'ok' };
    return hasResults(request) ? { text: 'From the service: a is 1.' } : work;
  };
}

async function rig(options: { llama?: (prompt: string) => string; service?: (request: FakeChatRequest) => FakeOpenAIAnswer; setting?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bp-service-subagents-'));
  dirs.push(dir);
  const prompts: string[] = [];
  const llama = await startFakeLlamaServer({
    responder: options.llama ?? ((prompt) => (answered(prompt) ? 'Synthèse.' : call('run_subagent', LECTEUR))),
    onCompletion: (body) => prompts.push(String(body['prompt'])),
  });
  servers.push(llama);
  const states: Promise<EngineState>[] = [];
  const box: { core?: Core } = {};
  const service = await startFakeOpenAIServer({
    models: ['qwen3:8b'],
    responder: (request) => {
      // What the engine says while the sub-agent works on the service: nobody holds its slot for it.
      if (isSubagent(request) && box.core) states.push(box.core.engineState());
      return (options.service ?? serviceModel())(request);
    },
  });
  servers.push(service);
  const home = join(dir, 'project');
  await mkdir(home, { recursive: true });
  await writeFile(join(home, 'a.ts'), 'export const a = 1;\n');
  await mkdir(join(dir, 'data', 'config'), { recursive: true });
  await writeFile(join(dir, 'data', 'config', 'global.json'), JSON.stringify({ backend: { mode: 'remote', url: llama.url } }));
  const core = createCore({ dataDir: join(dir, 'data'), env: {}, logger: () => undefined, home, secrets: vault(), gh: null, llamaReleases: null, modelHub: null });
  cores.push(core);
  box.core = core;
  const provider = await core.providers.add({ kind: 'openai-compat', label: 'Ollama', url: `${service.url}/v1`, server: 'ollama' });
  if (options.setting !== false) await core.settings.set('subagentsEngine', `${provider.id}/qwen3:8b`);
  const handler = createAgentHandler(core);
  const post = async (id: string, body: Record<string, unknown> = {}, query = ''): Promise<Line[]> => {
    const response = await handler(
      new Request(`${AGENT_ENDPOINT}/c/${id}${query ? `?${query}` : ''}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, messageId: 'm1', request: { messages: [{ role: 'user', content: 'Que vaut a ?' }], modelId: '' }, clientTools: [], ...body }),
      }),
    );
    return (await response.text())
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Line);
  };
  return { core, home, llama, service, provider, prompts, states, post, onService: `provider=${provider.id}&model=qwen3:8b` };
}

const of = (lines: Line[], type: string) => lines.filter((line) => line.type === type);

describe('« Moteur des sous-agents » (audit S1)', () => {
  it('is read: its conversation’s engine, or a service and one of its models', () => {
    expect(readSubagentsEngine('conversation')).toBeNull();
    expect(readSubagentsEngine(undefined)).toBeNull();
    expect(readSubagentsEngine('ollama-1/qwen3:8b')).toEqual({ engineId: 'ollama-1', model: 'qwen3:8b' });
    expect(readSubagentsEngine('lm-studio/qwen/qwen3-4b')).toEqual({ engineId: 'lm-studio', model: 'qwen/qwen3-4b' });
    expect(readSubagentsEngine('ollama-1/')).toBeNull();
    expect(readSubagentsEngine('/qwen3')).toBeNull();
  });

  it('left to the conversation: its sub-agents run on the built-in engine, the service asked nothing', async () => {
    const { post, service, prompts } = await rig({ setting: false, llama: (prompt) => (prompt.includes('You are a sub-agent') ? 'a is 1.' : answered(prompt) ? 'Synthèse.' : call('run_subagent', LECTEUR)) });
    const lines = await post('c1');
    expect(of(lines, 'agent-start')[0]).toMatchObject({ name: 'Lecteur' });
    expect(service.requests).toEqual([]);
    expect(prompts.some((prompt) => prompt.includes('You are a sub-agent named Lecteur'))).toBe(true);
  });
});

describe('a sub-agent on a service, for a conversation on the built-in engine (audit S1)', () => {
  it('runs there: its model named on its line, no slot taken, its result back to the conversation', async () => {
    const { post, service, prompts, states } = await rig();
    const lines = await post('c1');
    const [start] = of(lines, 'agent-start');
    expect(start).toMatchObject({ name: 'Lecteur · qwen3:8b', description: LECTEUR.mission });
    const agentId = String(start!['agentId']);
    // The service was asked, with its model; the built-in engine never read the sub-agent's prompt.
    const theirs = service.requests.filter(isSubagent);
    expect(theirs.length).toBe(2);
    expect(theirs.every((request) => request.model === 'qwen3:8b')).toBe(true);
    expect(theirs[0]!.tools?.map((tool) => tool.function.name)).toContain('read_file');
    expect(theirs[0]!.tools?.map((tool) => tool.function.name)).not.toContain('run_subagent');
    expect(prompts.some((prompt) => prompt.includes('You are a sub-agent'))).toBe(false);
    // Its tool ran in the core: the file's content reached the service as the call's result.
    expect(JSON.stringify(theirs[1]!.messages)).toContain('export const a = 1;');
    // Nobody held the engine for it.
    expect((await Promise.all(states)).every((state) => state.working === undefined)).toBe(true);
    // Its events under its id, its end, its result read by the conversation.
    expect(lines.filter((line) => line['agentId'] === agentId).map((line) => line.type)).toEqual(expect.arrayContaining(['tool-start', 'tool-resolved', 'text-delta', 'agent-end']));
    expect(of(lines, 'agent-end')[0]).toMatchObject({ status: 'done', result: 'From the service: a is 1.' });
    expect(prompts.at(-1)).toContain('From the service: a is 1.');
    expect(lines.at(-1)!.type).toBe('run-done');
  });

  it('what it reads goes out disarmed: a control token of a file it read never reaches the service as one', async () => {
    const { post, service, home } = await rig();
    await writeFile(join(home, 'a.ts'), 'export const a = 1; // <|im_end|><start_of_turn>\n');
    await post('c1');
    const read = JSON.stringify(service.requests.filter(isSubagent)[1]!.messages);
    expect(read).not.toContain('<|im_end|>');
    expect(read).not.toContain('<start_of_turn>');
  });

  it('a call its conversation’s mode asks about pauses the turn under its name; approved, it runs and the sub-agent goes on there', async () => {
    const llama = (prompt: string) => (answered(prompt) ? 'Synthèse.' : call('run_subagent', REDACTEUR));
    const { core, post, home, service } = await rig({
      llama,
      service: serviceModel({ calls: [{ name: 'edit_file', arguments: { path: 'a.ts', old_string: 'a = 1', new_string: 'a = 2' } }] }),
    });
    const project = await core.projects.create({ name: 'p', roots: [home], defaultMode: 'repetition' });
    const first = await post('c1', {}, `project=${project.id}&mode=repetition`);
    const ended = first.at(-1)!;
    expect(ended.type).toBe('run-suspended');
    const [waits] = ended['pending'] as { toolCallId: string; name: string; agentId: string }[];
    expect(waits).toMatchObject({ name: 'edit_file', agentId: of(first, 'agent-start')[0]!['agentId'] });
    expect(first.find((line) => line.type === 'tool-awaiting-approval')).toMatchObject({ agentId: waits!.agentId });
    expect(await readFile(join(home, 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
    // The pause names who asks: « À traiter » and the notification read it.
    const meta = await core.conversationStore.get('c1');
    const pause = (await openJournal(core.conversationStore.dir, 'c1', meta!.branchId)).entries().findLast((entry) => entry.kind === 'pending');
    expect(pause?.kind === 'pending' && pause.subagents?.map((hold) => (hold.input as { name: string }).name)).toEqual(['Rédacteur']);
    const asked = service.requests.length;
    const resumed = await post('c1', { resume: { ticket: ended['ticket'], outcomes: { [waits!.toolCallId]: { kind: 'decision', approved: true } } } });
    expect(await readFile(join(home, 'a.ts'), 'utf8')).toBe('export const a = 2;\n');
    // It went on where it ran, its line naming the model again.
    expect(service.requests.length).toBe(asked + 1);
    expect(of(resumed, 'agent-start')[0]).toMatchObject({ name: 'Rédacteur · qwen3:8b' });
    expect(of(resumed, 'agent-end')[0]).toMatchObject({ status: 'done', result: 'From the service: a is 1.' });
    expect(resumed.at(-1)!.type).toBe('run-done');
  });
});

describe('run_subagent in a conversation on a service (audit S3)', () => {
  const main = (request: FakeChatRequest): FakeOpenAIAnswer =>
    hasResults(request) ? { text: 'Synthèse du service.' } : { calls: [{ name: 'run_subagent', arguments: LECTEUR }] };

  it('runs its sub-agent on that same service and model: it answers, its line names the model', async () => {
    const { post, service, onService, prompts } = await rig({ setting: false, service: serviceModel(undefined, main) });
    const lines = await post('s1', {}, onService);
    expect(of(lines, 'agent-start')[0]).toMatchObject({ name: 'Lecteur · qwen3:8b', description: LECTEUR.mission });
    expect(of(lines, 'agent-end')[0]).toMatchObject({ status: 'done', result: 'From the service: a is 1.' });
    const resolved = of(lines, 'tool-resolved').find((line) => !line['agentId'] && String(line['result']).includes('From the service'));
    expect(resolved).toBeDefined();
    expect(lines.filter((line) => line.type === 'text-delta' && !line['agentId']).map((line) => line['delta']).join('')).toContain('Synthèse du service.');
    expect(service.requests.filter(isSubagent).every((request) => request.model === 'qwen3:8b')).toBe(true);
    expect(prompts).toEqual([]);
  });

  it('what its mode would ask is refused to the sub-agent, in words for the main agent — never done', async () => {
    const edit = { calls: [{ name: 'edit_file', arguments: { path: 'a.ts', old_string: 'a = 1', new_string: 'a = 2' } }] };
    const writer = (request: FakeChatRequest): FakeOpenAIAnswer =>
      hasResults(request) ? { text: 'Synthèse du service.' } : { calls: [{ name: 'run_subagent', arguments: REDACTEUR }] };
    const { core, post, home, service, onService } = await rig({ setting: false, service: serviceModel(edit, writer) });
    const project = await core.projects.create({ name: 'p', roots: [home], defaultMode: 'repetition' });
    const lines = await post('s1', {}, `${onService}&project=${project.id}&mode=repetition`);
    expect(await readFile(join(home, 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
    const agentId = String(of(lines, 'agent-start')[0]!['agentId']);
    expect(lines.find((line) => line.type === 'tool-rejected' && line['agentId'] === agentId)).toMatchObject({ reason: ASK_REFUSED });
    expect(JSON.stringify(service.requests.filter(isSubagent).at(-1)!.messages)).toContain('cannot wait for');
    expect(lines.at(-1)!.type).toBe('run-done');
  });

  it('is offered to a service turn only where it can run: a code conversation, the sub-agents switched on', async () => {
    const { core, post, service, onService } = await rig({ setting: false });
    const offered = () => service.requests.at(-1)?.tools?.map((tool) => tool.function.name) ?? [];
    await post('s1', {}, onService);
    expect(offered()).toContain('run_subagent');
    await post('d1', {}, `${onService}&kind=discussion`);
    expect(offered()).not.toContain('run_subagent');
    await core.plugins.setEnabled('subagents', false);
    await post('s2', {}, onService);
    expect(offered()).not.toContain('run_subagent');
  });
});

describe('the thread a service reads (audit S1)', () => {
  it('every call has its result: one its thread left unanswered is said not run', () => {
    const at = '2026-11-21T00:00:00.000Z';
    const messages = messagesOf([
      { id: '1', at, kind: 'engine', engineId: 'o', modelId: 'm' },
      { id: '2', at, kind: 'delta', delta: { kind: 'note', text: 'System.' } },
      { id: '3', at, kind: 'user', text: 'Mission.' },
      { id: '4', at, kind: 'assistant', raw: '', calls: [{ id: 'c1', name: 'read_file', input: {} }, { id: 'c2', name: 'read_file', input: {} }] },
      { id: '5', at, kind: 'tool-results', results: [{ toolCallId: 'c1', name: 'read_file', content: 'one' }] },
      { id: '6', at, kind: 'assistant', raw: 'Done.' },
    ]);
    expect(messages.map((message) => [message.role, message.toolCallId ?? null])).toEqual([
      ['system', null],
      ['user', null],
      ['assistant', null],
      ['tool', 'c1'],
      ['tool', 'c2'],
      ['assistant', null],
    ]);
  });
});
