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
