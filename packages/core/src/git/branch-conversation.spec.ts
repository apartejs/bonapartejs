/**
 * A conversation on its own branch, through the agent's turns (task 6.7):
 * nothing is made before its first write; that write makes the worktree and
 * the branch, and lands there, never in the project's folder; the next turn
 * tells the model its new folder as a note, the frozen prompt untouched.
 * A write that asks makes the worktree before it is asked, so what the card
 * shows is the branch's file; a worktree that cannot be made is said to the
 * model, the turn goes on.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, type Core } from '../api.js';
import { AGENT_ENDPOINT, createAgentHandler } from '../agent/handler.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';
import { tempRepo, type TempRepo } from '../testing/temp-repo.js';
import { git } from './git.js';

let servers: FakeLlamaServer[] = [];
let cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  for (const cleanup of cleanups.reverse()) await cleanup();
  servers = [];
  cleanups = [];
});

const Q = '<|"|>';
const call = (name: string, args: Record<string, string>): string =>
  `<|tool_call>call:${name}{${Object.entries(args)
    .map(([key, value]) => `${key}:${Q}${value}${Q}`)
    .join(',')}}<tool_call|>`;
const WRITE = call('write_file', { path: 'notes.txt', content: 'from the branch' });

type Line = { type: string; delta?: string; error?: string; reason?: string; ticket?: string; pending?: { toolCallId: string }[] };

/** The model: `Écris` asks for `write`, anything else is answered; after a tool, « Fait. ». */
function modelWriting(write: string) {
  return (prompt: string): string => {
    const user = prompt.slice(prompt.lastIndexOf('<|turn>user'));
    if (prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user')) return 'Fait.';
    return user.includes('Écris') ? write : 'ok';
  };
}

async function removeWorktrees(repo: TempRepo): Promise<void> {
  const listed = await git(['worktree', 'list', '--porcelain'], repo.dir);
  const dirs = listed.stdout
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .slice(1);
  for (const dir of dirs) {
    await git(['worktree', 'unlock', dir], repo.dir);
    await git(['worktree', 'remove', '--force', dir], repo.dir);
  }
}

async function setup(options: { write?: string | ((repo: string) => string); files?: Record<string, string>; ignored?: string[]; sub?: string } = {}) {
  const prompts: string[] = [];
  const repo = await tempRepo(options.files ?? { 'README.md': '# Projet\n' }, options.ignored);
  const write = typeof options.write === 'function' ? options.write(repo.dir) : (options.write ?? WRITE);
  const server = await startFakeLlamaServer({ responder: modelWriting(write), onCompletion: (body) => prompts.push(String(body['prompt'])) });
  servers.push(server);
  cleanups.push(async () => {
    await removeWorktrees(repo);
    await repo.remove();
  });
  const data = await mkdtemp(join(tmpdir(), 'bp-branch-'));
  cleanups.push(() => rm(data, { recursive: true, force: true }));
  await mkdir(join(data, 'config'), { recursive: true });
  await writeFile(join(data, 'config', 'global.json'), JSON.stringify({ backend: { mode: 'remote', url: server.url } }));
  const core: Core = createCore({ dataDir: data, env: {}, logger: () => undefined });
  const handler = createAgentHandler(core);
  const project = await core.projects.create({ name: 'Projet', roots: [options.sub ? join(repo.dir, options.sub) : repo.dir] });

  const said = new Map<string, { role: string; content: string }[]>();
  const post = async (conversation: string, body: Record<string, unknown>, query = ''): Promise<Line[]> => {
    const response = await handler(
      new Request(`${AGENT_ENDPOINT}/c/${conversation}${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, clientTools: [], ...body }),
      }),
    );
    return (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Line);
  };
  /** A turn of the person's; its lines. A turn that pauses leaves its reply to the resume. */
  const turn = async (conversation: string, text: string, query = ''): Promise<Line[]> => {
    const history = said.get(conversation) ?? [];
    history.push({ role: 'user', content: text });
    said.set(conversation, history);
    const lines = await post(conversation, { messageId: `m${history.length}`, request: { messages: history, modelId: '' } }, query);
    if (lines.at(-1)?.type !== 'run-suspended') history.push({ role: 'assistant', content: replyOf(lines) });
    return lines;
  };
  /** The person's answer to a pause: every call approved. */
  const approve = async (conversation: string, paused: Line[]): Promise<Line[]> => {
    const history = said.get(conversation)!;
    const ended = paused.at(-1)!;
    const outcomes = Object.fromEntries((ended.pending ?? []).map((pending) => [pending.toolCallId, { kind: 'decision', approved: true }]));
    const lines = await post(conversation, { messageId: `m${history.length}`, request: { messages: history, modelId: '' }, resume: { ticket: ended.ticket, outcomes } });
    history.push({ role: 'assistant', content: replyOf(lines) });
    return lines;
  };
  const branch = (name: string, mode = 'plume', base = 'main') =>
    `?project=${project.id}&mode=${mode}&worksIn=branch&branch=bonaparte/${encodeURIComponent(name)}&base=${base}`;
  return { core, repo, project, prompts, turn, approve, branch, data };
}

const replyOf = (lines: Line[]): string =>
  lines
    .filter((line) => line.type === 'text-delta')
    .map((line) => line.delta)
    .join('');

// git is slow when the whole suite runs at once.
describe('a conversation on its own branch', { timeout: 30_000 }, () => {
  it('makes its worktree at its first write, writes there, and tells the model its folder at the next turn', async () => {
    const { core, repo, prompts, turn, branch } = await setup();
    const worktree = join(repo.dir, '.bonaparte', 'worktrees', 'heures');
    await turn('c1', 'Bonjour', branch('heures'));
    expect(existsSync(worktree)).toBe(false);
    const frozen = prompts[0]!.slice(0, prompts[0]!.indexOf('<|turn>user'));

    await turn('c1', 'Écris la note');
    expect(await readFile(join(worktree, 'notes.txt'), 'utf8')).toBe('from the branch');
    expect(existsSync(join(repo.dir, 'notes.txt'))).toBe(false);
    expect((await git(['branch', '--show-current'], worktree)).stdout.trim()).toBe('bonaparte/heures');
    expect((await core.conversationStore.get('c1'))?.worktree).toBe(worktree);

    await turn('c1', 'Et maintenant ?');
    const last = prompts.at(-1)!;
    expect(last.startsWith(frozen)).toBe(true);
    // The note of the new folder: in this turn, not before the write.
    expect(prompts.slice(0, 2).some((prompt) => prompt.includes('worktrees'))).toBe(false);
    expect(last).toContain(worktree);
  });

  it('freezes the branch it will work on, never the checkout’s state; the worktree made, the note names its branch (review of round 2, 8)', async () => {
    const { repo, prompts, turn, branch } = await setup();
    // The person's own work in the checkout: not the branch's.
    await writeFile(join(repo.dir, 'mine.txt'), 'not committed\n');
    await turn('c1', 'Bonjour', branch('heures'));
    const first = prompts[0]!;
    expect(first).toContain('Git: you will work on branch bonaparte/heures, made from main at your first change; the project’s own checkout is not yours.');
    expect(first).not.toContain('mine.txt');
    expect(first).not.toContain('Git: branch main');

    await turn('c1', 'Écris la note');
    await turn('c1', 'Et maintenant ?');
    const note = prompts.at(-1)!.slice(first.lastIndexOf('<|turn>user'));
    expect(note).toContain(join(repo.dir, '.bonaparte', 'worktrees', 'heures'));
    expect(note).toContain('You now work on branch bonaparte/heures');
  });

  it('a write that asks makes the worktree first: the card shows the branch’s file, and the write lands there', async () => {
    const edit = call('edit_file', { path: 'notes.txt', old_string: 'first', new_string: 'second' });
    const { core, repo, turn, approve, branch } = await setup({ write: edit, files: { 'notes.txt': 'first\n' } });
    // The person's own work in the project, not committed: the branch never sees it.
    await writeFile(join(repo.dir, 'notes.txt'), 'first, and mine\n');
    await turn('c1', 'Bonjour', branch('heures', 'repetition'));
    const paused = await turn('c1', 'Écris la note');
    expect(paused.at(-1)?.type).toBe('run-suspended');
    const worktree = join(repo.dir, '.bonaparte', 'worktrees', 'heures');
    expect(existsSync(worktree)).toBe(true);
    const preview = await core.previewCall('c1', { name: 'edit_file', input: { path: 'notes.txt', old_string: 'first', new_string: 'second' } });
    expect(JSON.stringify(preview)).not.toContain('and mine');

    await approve('c1', paused);
    expect(await readFile(join(worktree, 'notes.txt'), 'utf8')).toBe('second\n');
    expect(await readFile(join(repo.dir, 'notes.txt'), 'utf8')).toBe('first, and mine\n');
  });

  it('never writes the project’s own folder: a path there is refused, with the branch’s folder said', async () => {
    // The model names the project's folder, as the frozen prompt does.
    const { repo, turn, branch } = await setup({
      write: (dir) => call('write_file', { path: `${dir.replace(/\\/g, '/')}/notes.txt`, content: 'in the project' }),
      files: { 'notes.txt': 'first\n' },
    });
    await turn('c1', 'Bonjour', branch('heures'));
    const lines = await turn('c1', 'Écris la note');
    expect(await readFile(join(repo.dir, 'notes.txt'), 'utf8')).toBe('first\n');
    const refused = lines.find((line) => line.type === 'tool-rejected');
    expect(refused?.reason).toContain(join(repo.dir, '.bonaparte', 'worktrees', 'heures'));
    expect(lines.at(-1)?.type).toBe('run-done');
  });

  it('two conversations asking the same branch get two: the second’s name takes a number', async () => {
    const { repo, turn, branch } = await setup();
    await turn('c1', 'Bonjour', branch('heures'));
    await turn('c2', 'Bonjour', branch('heures'));
    await turn('c1', 'Écris la note');
    const second = await turn('c2', 'Écris la note');
    expect(second.at(-1)?.type).toBe('run-done');
    const other = join(repo.dir, '.bonaparte', 'worktrees', 'heures-2');
    expect(await readFile(join(other, 'notes.txt'), 'utf8')).toBe('from the branch');
    expect((await git(['branch', '--show-current'], other)).stdout.trim()).toBe('bonaparte/heures-2');
  });

  it('a base that does not exist is said to the model; the turn ends, and nothing is written', async () => {
    const { repo, turn, branch } = await setup();
    await turn('c1', 'Bonjour', branch('heures', 'plume', 'master'));
    const lines = await turn('c1', 'Écris la note');
    expect(lines.at(-1)?.type).toBe('run-done');
    expect(lines.find((line) => line.type === 'tool-failed')?.error).toContain('master');
    expect(existsSync(join(repo.dir, 'notes.txt'))).toBe(false);
  });

  it('a project in a folder of its repository works in the same folder of its worktree', async () => {
    const { repo, turn, branch } = await setup({ files: { 'packages/app/README.md': '# App\n', 'README.md': '# Repo\n' }, sub: 'packages/app' });
    await turn('c1', 'Bonjour', branch('heures'));
    await turn('c1', 'Écris la note');
    const worktree = join(repo.dir, '.bonaparte', 'worktrees', 'heures');
    expect(await readFile(join(worktree, 'packages', 'app', 'notes.txt'), 'utf8')).toBe('from the branch');
    expect(existsSync(join(worktree, 'notes.txt'))).toBe(false);
  });

  it('archived 30 days ago, a worktree and its branch go at the next start — never with work not committed', async () => {
    const { core, repo, turn, branch, data } = await setup();
    await turn('c1', 'Bonjour', branch('propre'));
    await turn('c1', 'Écris la note');
    await turn('c2', 'Bonjour', branch('sale'));
    await turn('c2', 'Écris la note');
    await turn('c3', 'Bonjour', branch('recente'));
    await turn('c3', 'Écris la note');
    const clean = join(repo.dir, '.bonaparte', 'worktrees', 'propre');
    const dirty = join(repo.dir, '.bonaparte', 'worktrees', 'sale');
    const recent = join(repo.dir, '.bonaparte', 'worktrees', 'recente');
    for (const dir of [clean, recent]) await git(['add', '-A'], dir).then(() => git(['commit', '-qm', 'done'], dir));
    const old = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
    for (const id of ['c1', 'c2']) {
      await core.conversationStore.mark(id, { archivedAt: old });
      await core.conversationArchived(id, true);
    }
    await core.conversationStore.mark('c3', { archivedAt: new Date().toISOString() });

    createCore({ dataDir: data, env: {}, logger: () => undefined });
    await expect.poll(() => existsSync(clean), { timeout: 10_000 }).toBe(false);
    await expect.poll(async () => (await git(['branch', '--list', 'bonaparte/propre'], repo.dir)).stdout.trim(), { timeout: 10_000 }).toBe('');
    expect(existsSync(dirty)).toBe(true);
    expect(existsSync(recent)).toBe(true);
  }, 30_000);

  it('takes a branch name in any language', async () => {
    const { core, turn, branch } = await setup();
    await turn('c1', 'Bonjour', branch('réunion'));
    expect((await core.conversationStore.get('c1'))?.branch).toBe('bonaparte/réunion');
  });
});
