/**
 * A conversation moved to another project (Paul, 2026-11-19; aparté 1.16, apartejs/aparte#269): its folders,
 * its tools and the new project's mode told as notes at its next turn — nothing re-rendered, the memory kept.
 * Never under a reply or a question that waits, and never a conversation on its own branch: its worktree belongs
 * to its project's repository.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentHandler, AGENT_ENDPOINT } from '../agent/handler.js';
import { createCore, MoveRefusedError, type Core } from '../api.js';
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

async function rig(paceMs = 0) {
  const prompts: string[] = [];
  const server = await startFakeLlamaServer({ responder: () => 'Bien reçu.', paceMs, onCompletion: (body) => prompts.push(String(body['prompt'])) });
  servers.push(server);
  const dir = await mkdtemp(join(tmpdir(), 'bp-move-'));
  dirs.push(dir);
  await mkdir(join(dir, 'data', 'config'), { recursive: true });
  await writeFile(join(dir, 'data', 'config', 'global.json'), JSON.stringify({ backend: { mode: 'remote', url: server.url } }));
  const first = join(dir, 'premier');
  const second = join(dir, 'second');
  await mkdir(first, { recursive: true });
  await mkdir(second, { recursive: true });
  const core = createCore({ dataDir: join(dir, 'data'), env: {}, home: join(dir, 'home'), gh: null, logger: () => undefined });
  cores.push(core);
  const a = await core.projects.create({ name: 'premier', roots: [first], defaultMode: 'repetition' });
  const b = await core.projects.create({ name: 'second', roots: [second], defaultMode: 'plume' });
  const handler = createAgentHandler(core);
  const history: { role: string; content: string }[] = [];
  const say = async (text: string, query = ''): Promise<void> => {
    history.push({ role: 'user', content: text });
    const response = await handler(
      new Request(`${AGENT_ENDPOINT}/c/c1${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, messageId: `m${history.length}`, request: { messages: history, modelId: '' }, clientTools: [] }),
      }),
    );
    const lines = (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; delta?: string });
    history.push({ role: 'assistant', content: lines.map((line) => (line.type === 'text-delta' ? String(line.delta) : '')).join('') });
  };
  return { core, a, b, first, second, prompts, say, handler, history };
}

describe('a conversation moved to another project', () => {
  it('its folders told after the frozen prompt, its mode kept; nothing re-rendered', async () => {
    const { core, a, b, second, prompts, say } = await rig();
    await say('Bonjour', `?project=${a.id}`);
    expect(await core.conversationStore.get('c1')).toMatchObject({ projectId: a.id });
    const before = prompts.at(-1)!;
    await core.moveConversation('c1', b.id);
    expect(await core.conversationStore.get('c1')).toMatchObject({ kind: 'code', projectId: b.id });
    expect((await core.modeOf('c1')).mode).toBe('repetition');
    await say('Et ici ?');
    const after = prompts.at(-1)!;
    // Append-only: what was frozen is the start of the next prompt.
    expect(after.startsWith(before.slice(0, before.lastIndexOf('<|turn>model')))).toBe(true);
    expect(after.slice(before.length)).toContain(second);
    const meta = await core.conversationStore.get('c1');
    const entries = (await openJournal(core.conversationStore.dir, 'c1', meta!.branchId)).entries();
    expect(entries.filter((entry) => entry.kind === 'rebase' || entry.kind === 'engine')).toEqual([]);
  });

  it('a code conversation keeps the mode it runs in: a plan presented in Lecture is not taken for one launched (review of 2026-11-20)', async () => {
    const { core, a, b, say } = await rig();
    await say('Bonjour', `?project=${a.id}&mode=lecture`);
    await core.moveConversation('c1', b.id);
    expect((await core.modeOf('c1')).mode).toBe('lecture');
  });

  it('one that chose its own branch is refused before its branch exists: that branch belongs to its project’s repository (review of 2026-11-20)', async () => {
    const { core, a, b, say } = await rig();
    await say('Bonjour', `?project=${a.id}&worksIn=branch&branch=bonaparte/essai&base=main`);
    await expect(core.moveConversation('c1', b.id)).rejects.toMatchObject({ reason: 'own-branch' });
    expect(await core.conversationStore.get('c1')).toMatchObject({ projectId: a.id });
  });

  it('a discussion moved into a project becomes a code conversation of it', async () => {
    const { core, b, say } = await rig();
    await say('Bonjour', '?kind=discussion');
    await core.moveConversation('c1', b.id);
    expect(await core.conversationStore.get('c1')).toMatchObject({ kind: 'code', projectId: b.id });
    // A discussion ran in Lecture for want of a project: it takes the project's mode.
    expect((await core.modeOf('c1')).mode).toBe('plume');
  });

  it('never while a question or an approval waits, nor a conversation on its own branch; an unknown project neither', async () => {
    const { core, a, b, say } = await rig();
    await say('Bonjour', `?project=${a.id}`);
    const meta = (await core.conversationStore.get('c1'))!;
    const journal = await openJournal(core.conversationStore.dir, 'c1', meta.branchId);
    await journal.append({ kind: 'pending', calls: [], ticket: 't' });
    await expect(core.moveConversation('c1', b.id)).rejects.toMatchObject({ name: 'MoveRefusedError', reason: 'waiting' });
    await journal.append({ kind: 'outcomes', outcomes: {} });
    await core.conversationStore.update('c1', { worktree: join(tmpdir(), 'wt') });
    await expect(core.moveConversation('c1', b.id)).rejects.toBeInstanceOf(MoveRefusedError);
    await expect(core.moveConversation('c1', b.id)).rejects.toMatchObject({ reason: 'own-branch' });
    await core.conversationStore.update('c1', { worktree: undefined });
    await expect(core.moveConversation('c1', 'nope')).rejects.toThrow(/No project/);
    expect(await core.conversationStore.get('c1')).toMatchObject({ projectId: a.id });
  });

  it('never under a reply that runs', async () => {
    const { core, a, b, prompts, say } = await rig(150);
    await say('Bonjour', `?project=${a.id}`);
    const asked = prompts.length;
    const running = say('Encore');
    // The engine writes the reply: the turn runs.
    await expect.poll(() => prompts.length).toBe(asked + 1);
    await expect(core.moveConversation('c1', b.id)).rejects.toMatchObject({ reason: 'busy' });
    expect(await core.conversationStore.get('c1')).toMatchObject({ projectId: a.id });
    await running;
    await core.moveConversation('c1', b.id);
    expect(await core.conversationStore.get('c1')).toMatchObject({ projectId: b.id });
  });
});
