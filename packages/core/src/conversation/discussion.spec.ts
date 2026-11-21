/**
 * A discussion (task 9.7, aligned with the market): a conversation without a project, in Lecture, that reaches
 * no file and runs nothing — the web only (asked) and the window's questions. Its own seed: its frozen system
 * turn is not the code one. « Travailler dans un projet… » makes it a code conversation of that project: the
 * tools, the folders and the mode told as notes after the frozen prompt, the next turn served by the cache.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentHandler, AGENT_ENDPOINT } from '../agent/handler.js';
import { createCore, type Core } from '../api.js';
import { openJournal } from '../journal/journal.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';
import { startFakeOpenAIServer, type FakeOpenAIServer } from '../testing/fake-openai-server.js';

const dirs: string[] = [];
const cores: Core[] = [];
const servers: FakeLlamaServer[] = [];
const openai: FakeOpenAIServer[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop().catch(() => undefined);
  for (const server of servers.splice(0)) await server.close();
  for (const service of openai.splice(0)) await service.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

type Line = { type: string; [key: string]: unknown };

async function rig() {
  const prompts: string[] = [];
  const server = await startFakeLlamaServer({ responder: () => 'Bien reçu.', onCompletion: (body) => prompts.push(String(body['prompt'])) });
  servers.push(server);
  const dir = await mkdtemp(join(tmpdir(), 'bp-discussion-'));
  dirs.push(dir);
  await mkdir(join(dir, 'data', 'config'), { recursive: true });
  await writeFile(join(dir, 'data', 'config', 'global.json'), JSON.stringify({ backend: { mode: 'remote', url: server.url } }));
  const folder = join(dir, 'projet');
  await mkdir(folder, { recursive: true });
  const core = createCore({ dataDir: join(dir, 'data'), env: {}, home: join(dir, 'home'), gh: null, logger: () => undefined });
  cores.push(core);
  const handler = createAgentHandler(core);
  const history: { role: string; content: string }[] = [];
  const say = async (text: string, query = ''): Promise<Line[]> => {
    history.push({ role: 'user', content: text });
    const response = await handler(
      new Request(`${AGENT_ENDPOINT}/c/d1${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, messageId: `m${history.length}`, request: { messages: history, modelId: '' }, clientTools: [] }),
      }),
    );
    const lines = (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Line);
    history.push({ role: 'assistant', content: lines.map((line) => (line.type === 'text-delta' ? String(line.delta) : '')).join('') });
    return lines;
  };
  return { core, folder, prompts, say };
}

describe('a discussion (task 9.7)', () => {
  it('started as a discussion: in Lecture, told of no file tool and no command — the web only', async () => {
    const { core, prompts, say } = await rig();
    await say('Bonjour', '?kind=discussion&mode=plume');
    expect(await core.conversationStore.get('d1')).toMatchObject({ kind: 'discussion' });
    expect((await core.modeOf('d1')).mode).toBe('lecture');
    const prompt = prompts.at(-1)!;
    expect(prompt).toContain('web_fetch');
    expect(prompt).not.toMatch(/read_file|list_files|edit_file|write_file|run_command|run_subagent/);
    // No note of the code's modes either: a discussion has no plan to present nor change to ask.
    expect(prompt).not.toMatch(/update_plan|\[mode\]/);
  });

  it('« Travailler dans un projet… »: the tools, the folders and the mode told after the frozen prompt, served by the cache', async () => {
    const { core, folder, prompts, say } = await rig();
    await say('Bonjour', '?kind=discussion');
    const before = prompts.at(-1)!;
    const project = await core.projects.create({ name: 'p', roots: [folder], defaultMode: 'plume' });
    await core.attachProject('d1', project.id);
    expect(await core.conversationStore.get('d1')).toMatchObject({ kind: 'code', projectId: project.id });
    expect((await core.modeOf('d1')).mode).toBe('plume');
    await say('Regarde le projet');
    const after = prompts.at(-1)!;
    // Append-only: what was frozen is the start of the next prompt, nothing re-rendered.
    expect(after.startsWith(before.slice(0, before.lastIndexOf('<|turn>model')))).toBe(true);
    const added = after.slice(before.length);
    expect(added).toContain('read_file');
    expect(added).toContain('edit_file');
    expect(added).toContain(folder);
    const meta = await core.conversationStore.get('d1');
    const entries = (await openJournal(core.conversationStore.dir, 'd1', meta!.branchId)).entries();
    // Nothing frozen again: no rebase, no change of model — notes after the frozen prompt.
    expect(entries.filter((entry) => entry.kind === 'rebase' || entry.kind === 'engine')).toEqual([]);
  });

  it('a conversation without the kind asked stays a code conversation: nothing changes for the others', async () => {
    const { core, say } = await rig();
    await say('Bonjour');
    expect(await core.conversationStore.get('d1')).toMatchObject({ kind: 'code' });
  });
});

describe('a discussion acts on a web page only once asked, each time (Paul, 2026-11-20; review of round 3, 8)', () => {
  const Q = '<|"|>';
  /** The model clicks « Accepter » then « Suivant » on its page, in one step, then says it is done. */
  const click = (target: string): string => `<|tool_call>call:browser_act{action:${Q}click${Q},selector:${Q}${target}${Q}}<tool_call|>`;
  const clicker = (prompt: string): string =>
    prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user') ? 'Fait.' : click('#accept') + click('#next');

  /** The built-in browser's act, as the app adds it: what it was asked to do is kept. */
  async function withBrowser(core: Core): Promise<unknown[]> {
    const acted: unknown[] = [];
    core.plugins.add(
      {
        id: 'browser',
        name: { en: 'Browser', fr: 'Navigateur' },
        version: '1.0.0',
        description: { en: 'Pages.', fr: 'Des pages.' },
        effects: [{ effect: 'execute', what: { en: 'clicks in the agent’s page', fr: 'clique dans la page de l’agent' } }],
        contributes: {
          tools: [
            {
              name: 'browser_act',
              description: 'Click or type in your own browser tab.',
              effect: 'execute',
              inputSchema: { type: 'object', properties: { action: { type: 'string' }, selector: { type: 'string' } } },
            },
          ],
        },
      },
      { builtin: true },
    );
    await core.plugins.activate('browser', {
      activate: (ctx) =>
        ctx.registerToolHandler('browser_act', async ({ input }) => {
          acted.push(input);
          return { content: 'Clicked.' };
        }),
    });
    return acted;
  }

  it('on the built-in engine: the click is asked, never refused by its Lecture, and runs once allowed', async () => {
    const server = await startFakeLlamaServer({ responder: clicker });
    servers.push(server);
    const dir = await mkdtemp(join(tmpdir(), 'bp-discussion-act-'));
    dirs.push(dir);
    await mkdir(join(dir, 'data', 'config'), { recursive: true });
    await writeFile(join(dir, 'data', 'config', 'global.json'), JSON.stringify({ backend: { mode: 'remote', url: server.url } }));
    const core = createCore({ dataDir: join(dir, 'data'), env: {}, home: join(dir, 'home'), gh: null, logger: () => undefined });
    cores.push(core);
    const acted = await withBrowser(core);
    const handler = createAgentHandler(core);
    const post = async (body: Record<string, unknown>, query = ''): Promise<Line[]> => {
      const response = await handler(
        new Request(`${AGENT_ENDPOINT}/c/d1${query}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, clientTools: [], ...body }) }),
      );
      return (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Line);
    };
    const asked = { role: 'user', content: 'Clique sur Accepter' };
    const first = await post({ messageId: 'm1', request: { messages: [asked], modelId: '' } }, '?kind=discussion');
    expect(await core.conversationStore.get('d1')).toMatchObject({ kind: 'discussion' });
    const suspended = first.at(-1) as Line & { pending: { toolCallId: string; name: string; reason: string; input?: unknown }[]; ticket: string };
    expect(suspended.type).toBe('run-suspended');
    // The second click waits behind the first.
    expect(suspended.pending).toMatchObject([
      { name: 'browser_act', reason: 'approval', input: { selector: '#accept' } },
      { name: 'browser_act', reason: 'queued', input: { selector: '#next' } },
    ]);
    expect(acted).toEqual([]);
    // « Autoriser » the first: it runs, and the resume judges the one behind it as the discussion's.
    const waiting = suspended.pending.map((call) => ({ id: call.toolCallId, name: call.name, input: call.input }));
    const second = await post({
      messageId: 'm1',
      request: { messages: [asked, { role: 'assistant', content: '', toolCalls: waiting }], modelId: '' },
      resume: { ticket: suspended.ticket, outcomes: { [suspended.pending[0]!.toolCallId]: { kind: 'decision', approved: true } } },
    });
    // The click behind it is asked in its turn — never refused by Lecture.
    expect(second.map((line) => line.type)).toContain('tool-resolved');
    expect(second.map((line) => line.type)).not.toContain('tool-rejected');
    expect(second.at(-1)).toMatchObject({ type: 'run-suspended', pending: [{ name: 'browser_act', reason: 'approval', input: { selector: '#next' } }] });
    expect(acted).toEqual([{ action: 'click', selector: '#accept' }]);
  });

  it('on a service: the click is asked too, never refused by its Lecture', async () => {
    const service = await startFakeOpenAIServer({
      key: 'sk-test',
      models: ['qwen3:8b'],
      responder: (request) =>
        request.messages.at(-1)?.role === 'tool' ? { text: 'Fait.' } : { calls: [{ name: 'browser_act', arguments: { action: 'click', selector: '#accept' } }] },
    });
    openai.push(service);
    const dir = await mkdtemp(join(tmpdir(), 'bp-discussion-act-'));
    dirs.push(dir);
    const held = new Map<string, string>();
    const core = createCore({
      dataDir: join(dir, 'data'),
      env: {},
      home: join(dir, 'home'),
      secrets: { get: async (n) => held.get(n), set: async (n, v) => void held.set(n, v), delete: async (n) => void held.delete(n), has: async (n) => held.has(n) },
      llamaReleases: null,
      gh: null,
      logger: () => undefined,
    });
    cores.push(core);
    const acted = await withBrowser(core);
    const provider = await core.providers.add({ kind: 'openai-compat', label: 'Ollama', url: `${service.url}/v1`, server: 'ollama' }, 'sk-test');
    const handler = createAgentHandler(core);
    const response = await handler(
      new Request(`${AGENT_ENDPOINT}/c/s1?kind=discussion&provider=${encodeURIComponent(provider.id)}&model=qwen3%3A8b`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, clientTools: [], messageId: 'm1', request: { messages: [{ role: 'user', content: 'Clique sur Accepter' }], modelId: '' } }),
      }),
    );
    const lines = (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Line);
    expect(await core.conversationStore.get('s1')).toMatchObject({ kind: 'discussion' });
    expect(lines.map((line) => line.type)).not.toContain('tool-rejected');
    expect(lines.at(-1)).toMatchObject({ type: 'run-suspended', pending: [{ name: 'browser_act', reason: 'approval' }] });
    expect(acted).toEqual([]);
  });
});
