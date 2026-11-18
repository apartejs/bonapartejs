/**
 * The built-in entries of the core on the Plugins page (task 11.3): « Sous-agents » and « Scripts du projet » are
 * switched off like a plugin — for the app or a project — and the core follows: `run_subagent` leaves the inventory
 * (told as a note at the next turn, the frozen prompt untouched), the new tab lists no script. And a plugin's tool
 * switched off then on again is told the same way to a conversation already open (the web search of a discussion).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_ENDPOINT, createAgentHandler } from '../agent/handler.js';
import { createCore, type Core } from '../api.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';

const dirs: string[] = [];
const cores: Core[] = [];
const servers: FakeLlamaServer[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop().catch(() => undefined);
  for (const server of servers.splice(0)) await server.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

type Line = { type: string; [key: string]: unknown };

async function rig() {
  const prompts: string[] = [];
  const server = await startFakeLlamaServer({ responder: () => 'Bien reçu.', onCompletion: (body) => prompts.push(String(body['prompt'])) });
  servers.push(server);
  const dir = await mkdtemp(join(tmpdir(), 'bp-entries-'));
  dirs.push(dir);
  await mkdir(join(dir, 'data', 'config'), { recursive: true });
  await writeFile(join(dir, 'data', 'config', 'global.json'), JSON.stringify({ backend: { mode: 'remote', url: server.url } }));
  const core = createCore({ dataDir: join(dir, 'data'), env: {}, home: join(dir, 'home'), gh: null, logger: () => undefined });
  cores.push(core);
  const handler = createAgentHandler(core);
  const histories = new Map<string, { role: string; content: string }[]>();
  const say = async (conversation: string, text: string, query = ''): Promise<Line[]> => {
    const history = histories.get(conversation) ?? [];
    histories.set(conversation, history);
    history.push({ role: 'user', content: text });
    const response = await handler(
      new Request(`${AGENT_ENDPOINT}/c/${conversation}${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, messageId: `${conversation}-${history.length}`, request: { messages: history, modelId: '' }, clientTools: [] }),
      }),
    );
    const lines = (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Line);
    history.push({ role: 'assistant', content: lines.map((line) => (line.type === 'text-delta' ? String(line.delta) : '')).join('') });
    return lines;
  };
  return { core, dir, prompts, say };
}

/** What the turn added after the last answer: the notes appended before the message, and the message. */
const lastUserPart = (prompt: string): string => prompt.slice(prompt.lastIndexOf('Bien reçu.'));

describe('the built-in entries of the core (task 11.3)', () => {
  it('are listed as built-in plugins, on by default', async () => {
    const { core } = await rig();
    await core.plugins.activateBuiltinEntries();
    const ids = core.plugins.status().map((one) => one.id);
    expect(ids).toEqual(expect.arrayContaining(['subagents', 'auto-titles', 'project-scripts']));
    expect(core.plugins.status().find((one) => one.id === 'subagents')).toMatchObject({ builtin: true, enabled: true });
  });

  it('« Sous-agents » switched off: run_subagent leaves the inventory, told at the next turn; switched on, it comes back', async () => {
    const { core, prompts, say } = await rig();
    await core.plugins.activateBuiltinEntries();
    await say('c1', 'Bonjour');
    expect(prompts.at(-1)).toContain('run_subagent');
    await core.plugins.setEnabled('subagents', false);
    await say('c1', 'Encore');
    expect(lastUserPart(prompts.at(-1)!)).toMatch(/Tools removed \(do not call them\): run_subagent/);
    await core.plugins.setEnabled('subagents', true);
    await say('c1', 'Et maintenant');
    expect(lastUserPart(prompts.at(-1)!)).toMatch(/Tools now available:[\s\S]*run_subagent/);
  });

  it('« Scripts du projet » switched off: the new tab lists no script', async () => {
    const { core, dir } = await rig();
    await core.plugins.activateBuiltinEntries();
    const folder = join(dir, 'projet');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'package.json'), JSON.stringify({ name: 'spanwise', scripts: { dev: 'vite' } }));
    const project = await core.projects.create({ name: 'spanwise', roots: [folder] });
    expect((await core.runs.list({ projectId: project.id })).runs).toHaveLength(1);
    await core.plugins.setEnabled('project-scripts', false, { projectId: project.id });
    expect((await core.runs.list({ projectId: project.id })).runs).toEqual([]);
  });

  it('a plugin’s tool switched off then on in a discussion already open: told each time at the next turn', async () => {
    const { core, prompts, say } = await rig();
    core.plugins.add(
      {
        id: 'web-search',
        name: 'Web search',
        version: '1.0.0',
        effects: [{ effect: 'network', what: 'the web' }],
        contributes: { tools: [{ name: 'web_search', description: 'Search the web.', effect: 'network' }] },
      },
      { builtin: true },
    );
    await core.plugins.activate('web-search', { activate: (ctx) => ctx.registerToolHandler('web_search', async () => ({ content: 'r' })) });
    await say('d1', 'Bonjour', '?kind=discussion');
    expect(prompts.at(-1)).toContain('web_search');
    await core.plugins.setEnabled('web-search', false);
    await say('d1', 'Encore');
    expect(lastUserPart(prompts.at(-1)!)).toMatch(/Tools removed \(do not call them\): web_search/);
    await core.plugins.setEnabled('web-search', true);
    await say('d1', 'Et maintenant');
    expect(lastUserPart(prompts.at(-1)!)).toMatch(/Tools now available:[\s\S]*web_search/);
  });
});
