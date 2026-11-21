/**
 * Two conversations in one project folder (audit C4). A new conversation of a project whose folder another
 * conversation works in — a reply running, a question or an approval waiting, changes applied and not undone —
 * is told who: the window then offers its own branch first. One on its own branch, or archived, takes nothing.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { git } from '../git/git.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_ENDPOINT, createAgentHandler } from '../agent/handler.js';
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

const Q = '<|"|>';
const WRITE = `<|tool_call>call:write_file{path:${Q}notes.txt${Q},content:${Q}nouveau${Q}}<tool_call|>`;
const answered = (prompt: string) => prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user');

async function rig(paceMs = 0) {
  const prompts: string[] = [];
  const server = await startFakeLlamaServer({
    responder: (prompt) => (prompt.includes('Écris la note') && !answered(prompt) ? WRITE : 'Bien reçu.'),
    paceMs,
    onCompletion: (body) => prompts.push(String(body['prompt'])),
  });
  servers.push(server);
  const dir = await mkdtemp(join(tmpdir(), 'bp-folder-'));
  dirs.push(dir);
  await mkdir(join(dir, 'data', 'config'), { recursive: true });
  await writeFile(join(dir, 'data', 'config', 'global.json'), JSON.stringify({ backend: { mode: 'remote', url: server.url } }));
  const folder = join(dir, 'projet');
  await mkdir(folder, { recursive: true });
  const core = createCore({ dataDir: join(dir, 'data'), env: {}, home: join(dir, 'home'), gh: null, logger: () => undefined });
  cores.push(core);
  const project = await core.projects.create({ name: 'projet', roots: [folder], defaultMode: 'plume' });
  const handler = createAgentHandler(core);
  const say = async (id: string, text: string, query = ''): Promise<void> => {
    const response = await handler(
      new Request(`${AGENT_ENDPOINT}/c/${id}${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, messageId: `m-${id}-${text}`, request: { messages: [{ role: 'user', content: text }], modelId: '' }, clientTools: [] }),
      }),
    );
    await response.text();
  };
  return { core, project, folder, say, prompts };
}

describe('who works in a project folder (audit C4)', () => {
  it('nobody: a conversation that only talked, and one on its own branch, take nothing', async () => {
    const { core, project, say } = await rig();
    expect(await core.projects.folderTaken(project.id)).toBeNull();
    await say('c1', 'Bonjour', `?project=${project.id}`);
    expect(await core.projects.folderTaken(project.id)).toBeNull();
    await say('c2', 'Écris la note', `?project=${project.id}&worksIn=branch&branch=bonaparte/essai&base=main`);
    expect(await core.projects.folderTaken(project.id)).toBeNull();
  });

  it('one whose changes stand in the folder: named, until they are undone', async () => {
    const { core, project, folder, say } = await rig();
    await writeFile(join(folder, 'notes.txt'), 'ancien\n');
    await say('c1', 'Écris la note', `?project=${project.id}&mode=plume`);
    await core.conversationStore.rename('c1', 'Refonte du login');
    expect(await core.projects.folderTaken(project.id)).toEqual({ conversationId: 'c1', title: 'Refonte du login' });
    const [changed] = await core.checkpoints.files('c1');
    await core.checkpoints.revertFile('c1', changed!.path);
    expect(await core.projects.folderTaken(project.id)).toBeNull();
  });

  it('in a git project, changes committed take the folder no more: only what git still shows changed counts (review of C4)', async () => {
    const { core, project, folder, say } = await rig();
    await writeFile(join(folder, 'notes.txt'), 'ancien\n');
    const run = async (...args: string[]) => expect((await git(args, folder)).code).toBe(0);
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.email', 'test@example.invalid');
    await run('config', 'user.name', 'Test');
    await run('config', 'commit.gpgsign', 'false');
    await run('config', 'core.autocrlf', 'false');
    await run('add', '-A');
    await run('commit', '-q', '-m', 'first');
    await say('c1', 'Écris la note', `?project=${project.id}&mode=plume`);
    expect(await core.projects.folderTaken(project.id)).toMatchObject({ conversationId: 'c1' });
    // The person commits the work: the conversation, idle, works in the folder no more.
    await run('commit', '-q', '-am', 'the note');
    expect(await core.checkpoints.files('c1')).toHaveLength(1);
    expect(await core.projects.folderTaken(project.id)).toBeNull();
  });

  it('without git, changes count only while they are recent: a day after, the folder is free (review of C4)', async () => {
    const { core, project, folder, say } = await rig();
    await writeFile(join(folder, 'notes.txt'), 'ancien\n');
    await say('c1', 'Écris la note', `?project=${project.id}&mode=plume`);
    expect(await core.projects.folderTaken(project.id)).toMatchObject({ conversationId: 'c1' });
    // The turn wrote a day ago.
    const turns = join(core.checkpoints.dir, 'c1');
    for (const turn of await readdir(turns)) {
      const path = join(turns, turn, 'manifest.json');
      const manifest = JSON.parse(await readFile(path, 'utf8')) as { at?: string };
      manifest.at = new Date(Date.now() - 24 * 3600_000).toISOString();
      await writeFile(path, JSON.stringify(manifest));
    }
    expect(await core.projects.folderTaken(project.id)).toBeNull();
  });

  it('one whose question or approval waits, and one whose reply runs', async () => {
    const { core, project, say, prompts } = await rig(150);
    await say('c1', 'Bonjour', `?project=${project.id}`);
    const meta = (await core.conversationStore.get('c1'))!;
    const journal = await openJournal(core.conversationStore.dir, 'c1', meta.branchId);
    await journal.append({ kind: 'pending', calls: [], ticket: 't' });
    expect(await core.projects.folderTaken(project.id)).toMatchObject({ conversationId: 'c1' });
    await journal.append({ kind: 'outcomes', outcomes: {} });
    expect(await core.projects.folderTaken(project.id)).toBeNull();

    const asked = prompts.length;
    const running = say('c3', 'Encore', `?project=${project.id}`);
    await expect.poll(() => prompts.length, { timeout: 15_000 }).toBe(asked + 1);
    expect(await core.projects.folderTaken(project.id)).toMatchObject({ conversationId: 'c3' });
    await running;
    expect(await core.projects.folderTaken(project.id)).toBeNull();
  });
});
