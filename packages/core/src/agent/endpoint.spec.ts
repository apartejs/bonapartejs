/**
 * The endpoint path (task 9.2): a conversation on a service that speaks OpenAI's API goes through aparté's own
 * agent handler — the service's loop —, with the core's tools and the core's approval policy, never through the
 * built-in engine. Posted to the same address as every turn, as the window posts it.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, type Core } from '../api.js';
import { openJournal } from '../journal/journal.js';
import type { SecretStore } from '../providers/secrets.js';
import { tempRepo } from '../testing/temp-repo.js';
import { startFakeOpenAIServer, type FakeChatRequest, type FakeOpenAIAnswer, type FakeOpenAIServer } from '../testing/fake-openai-server.js';
import { AGENT_ENDPOINT, createAgentHandler } from './handler.js';

const dirs: string[] = [];
const cores: Core[] = [];
const services: FakeOpenAIServer[] = [];

afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop().catch(() => undefined);
  for (const service of services.splice(0)) await service.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

function vault(): SecretStore {
  const held = new Map<string, string>();
  return {
    get: async (name) => held.get(name),
    set: async (name, value) => void held.set(name, value),
    delete: async (name) => void held.delete(name),
    has: async (name) => held.has(name),
  };
}

type Line = { type: string; [key: string]: unknown };

async function rig(responder: (request: FakeChatRequest) => FakeOpenAIAnswer, mode: 'lecture' | 'repetition' | 'plume' | 'impro' = 'repetition') {
  const dir = await mkdtemp(join(tmpdir(), 'bp-endpoint-'));
  dirs.push(dir);
  const home = join(dir, 'home');
  await mkdir(home, { recursive: true });
  const service = await startFakeOpenAIServer({ key: 'sk-test', models: ['qwen3:8b'], responder });
  services.push(service);
  const core = createCore({ dataDir: join(dir, 'data'), env: {}, home, secrets: vault(), llamaReleases: null, gh: null, logger: () => undefined });
  cores.push(core);
  const provider = await core.providers.add({ kind: 'openai-compat', label: 'Ollama', url: `${service.url}/v1`, server: 'ollama' }, 'sk-test');
  await core.conversationStore.ensure('c1', { kind: 'code', engineId: provider.id, modelId: 'qwen3:8b', mode });
  if (mode === 'impro') await core.setMode('c1', 'impro', { confirmed: true });
  const handler = createAgentHandler(core);
  const post = async (body: Record<string, unknown>): Promise<{ status: number; lines: Line[] }> => {
    const response = await handler(
      new Request(`${AGENT_ENDPOINT}/c/c1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, clientTools: [], ...body }) }),
    );
    const text = await response.text();
    return { status: response.status, lines: response.status === 200 ? text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Line) : [{ type: 'http', body: text }] };
  };
  return { core, home, service, provider, post };
}

const said = (lines: Line[]): string => lines.map((line) => (line.type === 'text-delta' ? String(line.delta) : '')).join('');
const ask = (text: string) => ({ messages: [{ role: 'user', content: text }], modelId: '' });
const lastIsTool = (request: FakeChatRequest): boolean => request.messages.at(-1)?.role === 'tool';

describe('a conversation on a service (task 9.2)', () => {
  it('a turn of text: the service answers, through its own loop; it reads our system prompt in English and its key; no engine is needed', async () => {
    const { service, post } = await rig(() => ({ text: 'Bonjour Paul.' }));
    const { status, lines } = await post({ messageId: 'm1', request: ask('Bonjour') });
    expect(status).toBe(200);
    expect(said(lines)).toBe('Bonjour Paul.');
    expect(lines.at(-1)?.type).toBe('run-done');
    const [request] = service.requests;
    expect(request?.authorization).toBe('Bearer sk-test');
    expect(request?.model).toBe('qwen3:8b');
    expect(request?.messages[0]).toMatchObject({ role: 'system' });
    expect(String(request?.messages[0]?.content)).toMatch(/You are bonaparte/);
    expect(request?.messages.at(-1)).toMatchObject({ role: 'user', content: 'Bonjour' });
    expect(request?.tools?.map((tool) => tool.function.name)).toEqual(expect.arrayContaining(['read_file', 'edit_file', 'run_command']));
  });

  it('a call the policy asks pauses the turn, nothing written; the answer resumes it, and only then is the file written', async () => {
    const { home, post } = await rig((request) =>
      lastIsTool(request) ? { text: 'Fait.' } : { calls: [{ name: 'edit_file', arguments: { path: 'notes.txt', old_string: 'old line', new_string: 'new line' } }] },
    );
    await writeFile(join(home, 'notes.txt'), 'old line\n');
    const first = await post({ messageId: 'm1', request: ask('Change la note') });
    const suspended = first.lines.at(-1) as Line & { pending: { toolCallId: string; name: string; reason: string }[]; ticket: string };
    expect(suspended.type).toBe('run-suspended');
    expect(suspended.pending).toMatchObject([{ name: 'edit_file', reason: 'approval' }]);
    expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('old line\n');

    const outcomes = { [suspended.pending[0]!.toolCallId]: { kind: 'decision', approved: true } };
    // The window resumes with the history as it stands: it ends on the calls that wait.
    const waiting = suspended.pending.map((call) => ({ id: call.toolCallId, name: call.name, input: (call as { input?: unknown }).input }));
    const history = { messages: [{ role: 'user', content: 'Change la note' }, { role: 'assistant', content: '', toolCalls: waiting }], modelId: '' };
    const second = await post({ messageId: 'm1', request: history, resume: { ticket: suspended.ticket, outcomes } });
    expect(second.lines.map((line) => line.type)).toEqual(expect.arrayContaining(['tool-approved', 'tool-resolved', 'run-done']));
    expect(said(second.lines)).toBe('Fait.');
    expect(await readFile(join(home, 'notes.txt'), 'utf8')).toBe('new line\n');
  });

  it('a call the policy refuses is refused, and the model reads why', async () => {
    const { home, service, post } = await rig(
      (request) => (lastIsTool(request) ? { text: 'Compris.' } : { calls: [{ name: 'write_file', arguments: { path: 'x.txt', content: 'x' } }] }),
      'lecture',
    );
    const { lines } = await post({ messageId: 'm1', request: ask('Écris un fichier') });
    expect(lines.map((line) => line.type)).toContain('tool-rejected');
    expect(said(lines)).toBe('Compris.');
    expect(existsSync(join(home, 'x.txt'))).toBe(false);
    const refusal = service.requests.at(-1)?.messages.at(-1);
    expect(refusal).toMatchObject({ role: 'tool' });
    expect(String(refusal?.content)).toMatch(/Lecture|read-only|not allowed|refused/i);
  });

  it('a command after a change that waits for the person does not run before the answer', async () => {
    const { home, post } = await rig(
      (request) =>
        lastIsTool(request)
          ? { text: 'Fait.' }
          : {
              calls: [
                { name: 'write_file', arguments: { path: 'package.json', content: '{}\n' } },
                { name: 'run_command', arguments: { program: process.execPath, args: ['-e', "require('fs').writeFileSync('ran.txt','x')"] } },
              ],
            },
      'impro',
    );
    const first = await post({ messageId: 'm1', request: ask('Prépare le paquet, puis lance') });
    expect(first.lines.at(-1)?.type).toBe('run-suspended');
    expect(existsSync(join(home, 'ran.txt'))).toBe(false);
    expect(existsSync(join(home, 'package.json'))).toBe(false);
  });

  it('a conversation on its own branch writes in its worktree, never in the project’s own folder', async () => {
    const repo = await tempRepo({ 'notes.txt': 'old line\n' });
    try {
      const { core, post } = await rig(
        (request) => (lastIsTool(request) ? { text: 'Fait.' } : { calls: [{ name: 'write_file', arguments: { path: 'new.txt', content: 'x\n' } }] }),
        'plume',
      );
      const project = await core.projects.create({ name: 'p', roots: [repo.dir] });
      await core.conversationStore.update('c1', { projectId: project.id, worksIn: 'branch', branch: 'bonaparte/essai' });
      const { lines } = await post({ messageId: 'm1', request: ask('Écris new.txt') });
      expect(lines.map((line) => line.type)).toContain('tool-resolved');
      const meta = await core.conversationStore.get('c1');
      expect(meta?.worktree).toBeDefined();
      expect(existsSync(join(meta!.worktree!, 'new.txt'))).toBe(true);
      expect(existsSync(join(repo.dir, 'new.txt'))).toBe(false);
    } finally {
      for (const core of cores.splice(0)) await core.stop().catch(() => undefined);
      await repo.remove();
    }
  });

  it('the turn is written into the journal: the message and the answer — nothing frozen, no memory to keep', async () => {
    const { core, post } = await rig(() => ({ text: 'Bonjour Paul.' }));
    await post({ messageId: 'm1', request: ask('Bonjour') });
    const meta = await core.conversationStore.get('c1');
    const entries = (await openJournal(core.conversationStore.dir, 'c1', meta!.branchId)).entries();
    expect(entries.map((entry) => entry.kind)).toEqual(['user', 'assistant']);
    expect(entries[0]).toMatchObject({ kind: 'user', text: 'Bonjour' });
    expect(entries[1]).toMatchObject({ kind: 'assistant', raw: 'Bonjour Paul.' });
    expect(entries.every((entry) => entry.rendered === undefined)).toBe(true);
  });

  it('a conversation of the built-in engine never goes to the service', async () => {
    const { core, service } = await rig(() => ({ text: 'jamais' }));
    await core.conversationStore.ensure('c2', { kind: 'code', engineId: 'builtin', modelId: '', mode: 'repetition' });
    const response = await createAgentHandler(core)(
      new Request(`${AGENT_ENDPOINT}/c/c2`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, messageId: 'm1', request: ask('Bonjour'), clientTools: [] }),
      }),
    );
    expect(response.status).toBe(409);
    expect(service.requests).toHaveLength(0);
  });
});
