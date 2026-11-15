/**
 * A conversation on its own branch, through the agent's turns (task 6.7):
 * nothing is made before its first write; that write makes the worktree and
 * the branch, and lands there, never in the project's folder; the next turn
 * tells the model its new folder as a note, the frozen prompt untouched.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore } from '../api.js';
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
const WRITE = `<|tool_call>call:write_file{path:${Q}notes.txt${Q},content:${Q}from the branch${Q}}<tool_call|>`;

function model(prompt: string): string {
  const user = prompt.slice(prompt.lastIndexOf('<|turn>user'));
  if (prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user')) return 'Fait.';
  return user.includes('Écris') ? WRITE : 'ok';
}

describe('a conversation on its own branch', () => {
  it('makes its worktree at its first write, writes there, and tells the model its folder at the next turn', async () => {
    const prompts: string[] = [];
    const server = await startFakeLlamaServer({ responder: model, onCompletion: (body) => prompts.push(String(body['prompt'])) });
    servers.push(server);
    const repo: TempRepo = await tempRepo({ 'README.md': '# Projet\n' });
    cleanups.push(async () => {
      const worktree = join(repo.dir, '.bonaparte', 'worktrees', 'heures');
      await git(['worktree', 'unlock', worktree], repo.dir);
      await git(['worktree', 'remove', '--force', worktree], repo.dir);
      await repo.remove();
    });
    const data = await mkdtemp(join(tmpdir(), 'bp-branch-'));
    cleanups.push(() => rm(data, { recursive: true, force: true }));
    await mkdir(join(data, 'config'), { recursive: true });
    await writeFile(join(data, 'config', 'global.json'), JSON.stringify({ backend: { mode: 'remote', url: server.url } }));
    const core = createCore({ dataDir: data, env: {}, logger: () => undefined });
    const handler = createAgentHandler(core);
    const project = await core.projects.create({ name: 'Projet', roots: [repo.dir] });

    const said: { role: string; content: string }[] = [];
    const turn = async (text: string, query = ''): Promise<string> => {
      said.push({ role: 'user', content: text });
      const response = await handler(
        new Request(`${AGENT_ENDPOINT}/c/c1${query}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ v: 1, messageId: `m${said.length}`, request: { messages: said, modelId: '' }, clientTools: [] }),
        }),
      );
      const lines = (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; delta?: string });
      const reply = lines.filter((line) => line.type === 'text-delta').map((line) => line.delta).join('');
      said.push({ role: 'assistant', content: reply });
      return reply;
    };

    const worktree = join(repo.dir, '.bonaparte', 'worktrees', 'heures');
    await turn('Bonjour', `?project=${project.id}&mode=plume&worksIn=branch&branch=bonaparte/heures&base=main`);
    expect(existsSync(worktree)).toBe(false);
    const frozen = prompts[0]!.slice(0, prompts[0]!.indexOf('<|turn>user'));

    await turn('Écris la note');
    expect(await readFile(join(worktree, 'notes.txt'), 'utf8')).toBe('from the branch');
    expect(existsSync(join(repo.dir, 'notes.txt'))).toBe(false);
    expect((await git(['branch', '--show-current'], worktree)).stdout.trim()).toBe('bonaparte/heures');
    expect((await core.conversationStore.get('c1'))?.worktree).toBe(worktree);

    await turn('Et maintenant ?');
    const last = prompts.at(-1)!;
    expect(last.startsWith(frozen)).toBe(true);
    // The note of the new folder: in this turn, not before the write.
    expect(prompts.slice(0, 2).some((prompt) => prompt.includes('worktrees'))).toBe(false);
    expect(last).toContain(worktree);
  });
});
