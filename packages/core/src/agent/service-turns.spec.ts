/**
 * A conversation on a service, as the review of phase 9 checked it: its first turn takes what the window chose
 * (a discussion, a project, a mode); a retry or an edit branches its journal, as on the built-in engine, so that
 * it can go back there; back there, its system prompt is read once; a copy for the built-in engine goes there;
 * and its turns tell their end, a pause included, as every other turn does.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCore, type Core, type TurnEnd } from '../api.js';
import { openJournal } from '../journal/journal.js';
import { isRefrozen } from '../journal/types.js';
import type { SecretStore } from '../providers/secrets.js';
import { writeFakeGguf } from '../testing/fake-gguf.js';
import { startFakeOpenAIServer, type FakeChatRequest, type FakeOpenAIAnswer, type FakeOpenAIServer } from '../testing/fake-openai-server.js';
import { AGENT_ENDPOINT, createAgentHandler } from './handler.js';

const BIN = fileURLToPath(new URL('../testing/fake-llama-bin.mjs', import.meta.url));
const dirs: string[] = [];
const cores: Core[] = [];
const services: FakeOpenAIServer[] = [];

afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop().catch(() => undefined);
  for (const service of services.splice(0)) await service.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const vault = (): SecretStore => {
  const held = new Map<string, string>();
  return { get: async (n) => held.get(n), set: async (n, v) => void held.set(n, v), delete: async (n) => void held.delete(n), has: async (n) => held.has(n) };
};

type Message = { role: string; content: string; toolCalls?: unknown[] };

async function rig(responder: (request: FakeChatRequest) => FakeOpenAIAnswer = () => ({ text: 'Réponse du service.' })) {
  const dir = await mkdtemp(join(tmpdir(), 'bp-service-'));
  dirs.push(dir);
  const models = join(dir, 'models');
  const home = join(dir, 'home');
  await mkdir(models, { recursive: true });
  await mkdir(home, { recursive: true });
  const gemma = join(models, 'gemma-4-test.gguf');
  await writeFakeGguf(gemma, { paddingBytes: 4096 });
  const service = await startFakeOpenAIServer({ models: ['qwen3:8b'], responder });
  services.push(service);
  const core = createCore({
    dataDir: join(dir, 'data'),
    env: {},
    home,
    llamaCommand: [process.execPath, BIN],
    port: await freePort(),
    modelRoots: [{ dir: models, source: 'custom' }],
    gpuMemory: async () => 24 * 1024 ** 3,
    llamaReleases: null,
    modelHub: null,
    gh: null,
    secrets: vault(),
    logger: () => undefined,
  });
  cores.push(core);
  const provider = await core.providers.add({ kind: 'openai-compat', label: 'Ollama', url: `${service.url}/v1`, server: 'ollama' });
  const handler = createAgentHandler(core);
  /** A turn as the window posts it: the whole history it shows, the first turn's choices in the address. */
  const post = async (id: string, messages: Message[], query = '', resume?: unknown) => {
    const response = await handler(
      new Request(`${AGENT_ENDPOINT}/c/${id}${query ? `?${query}` : ''}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, messageId: resume ? 'm1' : `m${messages.length}`, request: { messages, modelId: '' }, clientTools: [], ...(resume ? { resume } : {}) }),
      }),
    );
    const lines = response.status === 200 ? (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; delta?: string }) : [];
    const answer = lines.map((line) => (line.type === 'text-delta' ? (line.delta ?? '') : '')).join('');
    return { status: response.status, lines, answer };
  };
  const onService = `provider=${provider.id}&model=qwen3:8b`;
  const entries = async (id: string) => {
    const meta = await core.conversationStore.get(id);
    return (await openJournal(core.conversationStore.dir, id, meta!.branchId)).entries();
  };
  const users = async (id: string) => (await entries(id)).flatMap((entry) => (entry.kind === 'user' ? [entry.text] : []));
  return { core, gemma, home, service, provider, post, onService, entries, users };
}

describe('a conversation started on a service takes what its first turn chose (review of phase 9)', () => {
  it('a discussion stays a discussion: Lecture, and the service is offered no tool that reaches the disk', async () => {
    const { core, service, post, onService } = await rig();
    expect((await post('d1', [{ role: 'user', content: 'Météo ?' }], `${onService}&kind=discussion`)).status).toBe(200);
    expect(await core.conversationStore.get('d1')).toMatchObject({ kind: 'discussion', mode: 'lecture' });
    const offered = service.requests[0]?.tools?.map((tool) => tool.function.name) ?? [];
    for (const name of ['read_file', 'list_files', 'search', 'edit_file', 'write_file', 'run_command']) expect(offered).not.toContain(name);
  }, 30_000);

  it('one started in a project belongs to it, in the mode the person chose', async () => {
    const { core, home, post, onService } = await rig();
    const project = await core.projects.create({ name: 'maison', roots: [home], defaultMode: 'repetition' });
    expect((await post('p1', [{ role: 'user', content: 'Bonjour' }], `${onService}&project=${project.id}&mode=plume&picked=1`)).status).toBe(200);
    expect(await core.conversationStore.get('p1')).toMatchObject({ projectId: project.id, mode: 'plume', kind: 'code' });
  }, 30_000);
});

describe('a retry or an edit on a service branches the journal, as on the built-in engine (review of phase 9)', () => {
  it('an edit: the journal says what the window shows, and back on the built-in engine the conversation goes on', async () => {
    const { core, gemma, post, onService, users } = await rig();
    await post('c1', [{ role: 'user', content: 'Q1' }], onService);
    await post('c1', [{ role: 'user', content: 'Q1' }, { role: 'assistant', content: 'Réponse du service.' }, { role: 'user', content: 'Q2' }]);
    // Q2 changed into Q2b.
    const edited = await post('c1', [{ role: 'user', content: 'Q1' }, { role: 'assistant', content: 'Réponse du service.' }, { role: 'user', content: 'Q2b' }]);
    expect(edited.status).toBe(200);
    expect(await users('c1')).toEqual(['Q1', 'Q2b']);

    await core.loadModel(gemma);
    await core.switchModel(gemma, { conversationId: 'c1' });
    const back = await post('c1', [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'Réponse du service.' },
      { role: 'user', content: 'Q2b' },
      { role: 'assistant', content: 'Réponse du service.' },
      { role: 'user', content: 'Q3' },
    ]);
    expect(back.status).toBe(200);
    expect(await users('c1')).toEqual(['Q1', 'Q2b', 'Q3']);
  }, 30_000);

  it('a retry answers the same message again, without a second copy of it', async () => {
    const { post, onService, users, service } = await rig();
    await post('c1', [{ role: 'user', content: 'Q1' }], onService);
    expect((await post('c1', [{ role: 'user', content: 'Q1' }])).status).toBe(200);
    expect(service.requests).toHaveLength(2);
    expect(await users('c1')).toEqual(['Q1']);
  }, 30_000);
});

describe('from a service back to the built-in engine (review of phase 9)', () => {
  it('a conversation started on a service reads its system prompt once — in the prompt frozen again, never after the person’s message', async () => {
    const { core, gemma, post, onService, entries } = await rig();
    await post('c1', [{ role: 'user', content: 'Q1' }], onService);
    await core.loadModel(gemma);
    await core.switchModel(gemma, { conversationId: 'c1' });
    expect((await post('c1', [{ role: 'user', content: 'Q1' }, { role: 'assistant', content: 'Réponse du service.' }, { role: 'user', content: 'Q2' }])).status).toBe(200);
    const all = await entries('c1');
    const frozen = all.findLastIndex((entry) => isRefrozen(entry) && entry.rendered !== undefined);
    expect(frozen).toBeGreaterThanOrEqual(0);
    expect(all.slice(frozen + 1).filter((entry) => entry.kind === 'system')).toEqual([]);
  }, 30_000);

  it('« Brancher sur ce modèle »: the copy runs on the built-in engine, never on the service', async () => {
    const { core, gemma, post, onService, service } = await rig();
    await post('c1', [{ role: 'user', content: 'Q1' }], onService);
    await core.loadModel(gemma);
    const { conversationId } = await core.switchModel(gemma, { conversationId: 'c1', as: 'copy' });
    expect(conversationId).toBeDefined();
    expect(await core.conversationStore.get(conversationId!)).toMatchObject({ engineId: 'builtin' });
    expect(await core.serviceOf(conversationId!)).toBeUndefined();
    const asked = service.requests.length;
    const copy = await post(conversationId!, [{ role: 'user', content: 'Q1' }, { role: 'assistant', content: 'Réponse du service.' }, { role: 'user', content: 'Q2' }]);
    expect(copy.status).toBe(200);
    expect(service.requests).toHaveLength(asked);
    // The original stays on the service.
    expect(await core.serviceOf('c1')).toBeDefined();
  }, 30_000);
});

describe('a turn on a service tells its end (review of phase 9)', () => {
  it('done: the notifications hear it', async () => {
    const { core, post, onService } = await rig();
    const ends: TurnEnd[] = [];
    core.onTurnEnd((end) => ends.push(end));
    await post('c1', [{ role: 'user', content: 'Bonjour' }], onService);
    await vi.waitFor(() => expect(ends).toMatchObject([{ conversationId: 'c1', how: 'done', said: 'Réponse du service.' }]));
  }, 30_000);

  it('waiting for an approval: told, the conversation says it waits, « À traiter » lists it — and the answer ends the wait', async () => {
    const { core, home, post, onService } = await rig((request) =>
      request.messages.at(-1)?.role === 'tool'
        ? { text: 'Fait.' }
        : { calls: [{ name: 'edit_file', arguments: { path: 'notes.txt', old_string: 'old', new_string: 'new' } }] },
    );
    await writeFile(join(home, 'notes.txt'), 'old\n');
    const ends: TurnEnd[] = [];
    core.onTurnEnd((end) => ends.push(end));
    const first = await post('c1', [{ role: 'user', content: 'Change la note' }], onService);
    expect(first.lines.at(-1)?.type).toBe('run-suspended');
    await vi.waitFor(() => expect(ends).toMatchObject([{ conversationId: 'c1', how: 'approval', call: { name: 'edit_file' } }]));
    expect(await core.conversations.status('c1')).toMatchObject({ waiting: true });
    expect((await core.inbox()).approvals).toMatchObject([{ conversationId: 'c1' }]);

    const suspended = first.lines.at(-1) as unknown as { pending: { toolCallId: string; name: string; input: unknown }[]; ticket: string };
    const outcomes = { [suspended.pending[0]!.toolCallId]: { kind: 'decision', approved: true } };
    const waiting = suspended.pending.map((call) => ({ id: call.toolCallId, name: call.name, input: call.input }));
    const second = await post('c1', [{ role: 'user', content: 'Change la note' }, { role: 'assistant', content: '', toolCalls: waiting }], '', {
      ticket: suspended.ticket,
      outcomes,
    });
    expect(second.status, JSON.stringify(second.lines)).toBe(200);
    expect(second.answer, JSON.stringify(second.lines)).toBe('Fait.');
    expect(await core.conversations.status('c1')).toMatchObject({ waiting: false });
    expect((await core.inbox()).approvals).toEqual([]);
  }, 30_000);
});
