import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConversationStore,
  cutAfterTurn,
  rebuildTranscript,
  type ConversationEvent,
} from './store.js';

let dirs: string[] = [];

async function makeStore(): Promise<ConversationStore> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-conv-'));
  dirs.push(dir);
  return new ConversationStore(dir);
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

describe('ConversationStore', () => {
  it('creates a conversation untitled — the interface names it in its own language', async () => {
    // A default title stored in one language would show up wrong in the
    // other. An empty title means "not named yet"; the first message or the
    // user gives the real one, and the UI shows a localised placeholder
    // until then.
    const store = await makeStore();
    await store.create('fresh');
    expect((await store.meta('fresh')).title).toBe('');
  });

  it('attaches the conversation to a project, not to the application', async () => {
    // The conversation references a PROJECT; it's the project that carries
    // the roots. Two conversations on two different projects must
    // coexist without stepping on each other.
    const store = await makeStore();
    await store.create('a', { projectId: 'proj-alpha' });
    await store.create('b', { projectId: 'proj-beta' });

    expect((await store.meta('a')).projectId).toBe('proj-alpha');
    expect((await store.meta('b')).projectId).toBe('proj-beta');
  });

  it('a conversation with no project remains valid', async () => {
    // Established invariant: discussing with no folder still works, and
    // the tools work too — with no confinement.
    const store = await makeStore();
    await store.create('libre');
    expect((await store.meta('libre')).projectId).toBeUndefined();
  });

  it('setProjectId attaches then detaches afterward', async () => {
    const store = await makeStore();
    await store.create('c');

    await store.setProjectId('c', 'proj-gamma');
    expect((await store.meta('c')).projectId).toBe('proj-gamma');

    // Removing from the project must make the conversation "project-less",
    // not leave an orphaned id pointing at nothing.
    await store.setProjectId('c', undefined);
    expect((await store.meta('c')).projectId).toBeUndefined();
  });

  it('setFrozenRoots retains the scope in effect at freeze time', async () => {
    // This is the basis of the delta: without it, reopening a conversation
    // would think the scope had just appeared and would announce it for nothing.
    const store = await makeStore();
    await store.create('f');

    await store.setFrozenRoots('f', ['/a', '/b']);
    expect((await store.meta('f')).frozenRoots).toEqual(['/a', '/b']);

    // The order is semantic: it must be kept as-is.
    await store.setFrozenRoots('f', ['/b', '/a']);
    expect((await store.meta('f')).frozenRoots).toEqual(['/b', '/a']);
  });

  it('setSetting sets then removes a conversation override', async () => {
    const store = await makeStore();
    await store.create('s');
    await store.setSetting('s', 'temperature', 0.2);
    expect((await store.meta('s')).settings).toEqual({ temperature: 0.2 });

    // undefined = revert to inheritance, not store a hole.
    await store.setSetting('s', 'temperature', undefined);
    expect((await store.meta('s')).settings).toEqual({});
  });

  it('setTitle renames without touching the rest', async () => {
    const store = await makeStore();
    await store.create('d', { title: 'Sans titre', projectId: 'proj-delta' });
    await store.setTitle('d', 'Refonte du parser');
    const meta = await store.meta('d');
    expect(meta.title).toBe('Refonte du parser');
    expect(meta.projectId).toBe('proj-delta');
  });

  it('create then listMeta exposes the conversation', async () => {
    const store = await makeStore();
    await store.create('conv-1', { title: 'Ma conversation' });
    const metas = await store.listMeta();
    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({ id: 'conv-1', title: 'Ma conversation' });
    expect(await store.exists('conv-1')).toBe(true);
    expect(await store.exists('fantome')).toBe(false);
  });

  it('appendEvent + loadEvents return the log in order', async () => {
    const store = await makeStore();
    await store.create('conv-1');
    await store.appendEvent('conv-1', {
      type: 'user',
      text: 'Bonjour',
      at: '2026-08-18T10:00:00.000Z',
    });
    await store.appendEvent('conv-1', {
      type: 'assistant',
      entry: { role: 'assistant', text: 'Salut !', thinking: 'hm', raw: '<think>hm</think>Salut !' },
      at: '2026-08-18T10:00:05.000Z',
    });
    const events = await store.loadEvents('conv-1');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'user', text: 'Bonjour' });
    expect(events[1]).toMatchObject({ type: 'assistant' });
  });

  it('loadEvents on an unknown conversation throws a clear error', async () => {
    const store = await makeStore();
    await expect(store.loadEvents('fantome')).rejects.toThrow(/fantome/);
  });

  it('pins the model AND the context size at creation', async () => {
    const store = await makeStore();
    await store.create('conv-1', { modelPath: 'D:\\models\\qwen3.gguf', nCtx: 32768 });
    const meta = await store.meta('conv-1');
    expect(meta.modelPath).toBe('D:\\models\\qwen3.gguf');
    expect(meta.nCtx).toBe(32768);
  });

  it('setModel sets model + nCtx on a conversation that had none', async () => {
    const store = await makeStore();
    await store.create('conv-1');
    expect((await store.meta('conv-1')).modelPath).toBeUndefined();
    await store.setModel('conv-1', 'D:\\models\\qwen3.gguf', 16384);
    const meta = await store.meta('conv-1');
    expect(meta.modelPath).toBe('D:\\models\\qwen3.gguf');
    expect(meta.nCtx).toBe(16384);
  });

  it('freezes the backend state and the tool inventory', async () => {
    const store = await makeStore();
    await store.create('conv-1');
    await store.freezeBackendState('conv-1', { systemPrompt: 'SYS frozen' }, [
      'read_file',
    ]);
    const meta = await store.meta('conv-1');
    expect(meta.backendState).toEqual({ systemPrompt: 'SYS frozen' });
    expect(meta.toolNames).toEqual(['read_file']);
  });

  it('meta throws a clear error for an unknown conversation', async () => {
    const store = await makeStore();
    await expect(store.meta('fantome')).rejects.toThrow(/fantome/);
  });

  it('appendEvent updates updatedAt', async () => {
    const store = await makeStore();
    const created = await store.create('conv-1');
    await new Promise((r) => setTimeout(r, 10));
    await store.appendEvent('conv-1', {
      type: 'user',
      text: 'x',
      at: new Date().toISOString(),
    });
    const [meta] = await store.listMeta();
    expect(Date.parse(meta!.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });
});

describe('rebuildTranscript', () => {
  it('restores the semantic transcript from the persisted events', () => {
    const transcript = rebuildTranscript([
      { type: 'user', text: 'Q', at: 'x' },
      {
        type: 'assistant',
        entry: { role: 'assistant', text: 'R', raw: 'R' },
        at: 'x',
      },
      {
        type: 'tool_results',
        entry: {
          role: 'tool_results',
          results: [{ name: 't', ok: true, content: 'r' }],
        },
        at: 'x',
      },
      { type: 'service', text: '[update]', at: 'x' },
    ]);

    expect(transcript).toEqual([
      { role: 'user', text: 'Q' },
      { role: 'assistant', text: 'R', raw: 'R' },
      { role: 'tool_results', results: [{ name: 't', ok: true, content: 'r' }] },
      { role: 'service', text: '[update]' },
    ]);
  });
});
describe('ConversationStore — pin, archive, branch (P2.7)', () => {
  it('pin and archive are marks, not activity: they do not move the conversation in time', async () => {
    const store = await makeStore();
    await store.create('c');
    const before = (await store.meta('c')).updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));

    await store.setMarks('c', { pinned: true });
    await store.setMarks('c', { archived: true });

    const meta = await store.meta('c');
    expect(meta).toMatchObject({ pinned: true, archived: true });
    expect(meta.updatedAt).toBe(before);
    await store.setMarks('c', { pinned: false, archived: false });
    expect(await store.meta('c')).not.toHaveProperty('pinned');
  });

  it('a branch copies the frozen prompt and the log up to a point, and names its parent', async () => {
    const store = await makeStore();
    await store.create('parent', { title: 'Parent', modelPath: 'm.gguf', projectId: 'p' });
    await store.freezeBackendState('parent', { systemPrompt: 'FROZEN' }, ['read_file']);
    await store.setFrozenRoots('parent', ['C:\p']);
    await store.setSetting('parent', 'temperature', 0.3);
    await store.appendEvent('parent', { type: 'user', text: 'one', at: 't1' });
    await store.appendEvent('parent', { type: 'service', text: 'svc', at: 't2' });
    await store.appendEvent('parent', { type: 'user', text: 'two', at: 't3' });

    await store.branch('parent', 'child', { keepEvents: 2, title: 'Parent (branch)' });

    const child = await store.meta('child');
    expect(child).toMatchObject({
      title: 'Parent (branch)',
      modelPath: 'm.gguf',
      projectId: 'p',
      backendState: { systemPrompt: 'FROZEN' },
      toolNames: ['read_file'],
      frozenRoots: ['C:\p'],
      settings: { temperature: 0.3 },
      parentId: 'parent',
    });
    expect((await store.loadEvents('child')).map((e) => ('text' in e ? e.text : ''))).toEqual(['one', 'svc']);
    // The parent is untouched.
    expect(await store.loadEvents('parent')).toHaveLength(3);
  });

  it('without a cut, a branch is a duplicate: the whole log', async () => {
    const store = await makeStore();
    await store.create('a', { title: 'A' });
    await store.appendEvent('a', { type: 'user', text: 'x', at: 't' });
    await store.branch('a', 'b', { title: 'A (copy)' });
    expect(await store.loadEvents('b')).toHaveLength(1);
  });
});

describe('cutAfterTurn — where a branch from a readable turn cuts the log', () => {
  it('after an assistant turn: just before the next user message, its tool rounds included', () => {
    const events: ConversationEvent[] = [
      { type: 'user', text: 'q1', at: 't' },
      { type: 'assistant', entry: { role: 'assistant', text: 'calling', raw: 'calling', calls: [{ name: 'read_file', arguments: {} }] }, at: 't' },
      { type: 'tool_results', entry: { role: 'tool_results', results: [{ name: 'read_file', ok: true, content: 'c' }] }, at: 't' },
      { type: 'assistant', entry: { role: 'assistant', text: 'a1', raw: 'a1' }, at: 't' },
      { type: 'user', text: 'q2', at: 't' },
      { type: 'assistant', entry: { role: 'assistant', text: 'a2', raw: 'a2' }, at: 't' },
    ];
    // Readable turns: 0 user q1, 1 assistant (3 raw events), 2 user q2, 3 assistant a2.
    expect(cutAfterTurn(events, 1)).toBe(4);
    expect(cutAfterTurn(events, 0)).toBe(1);
    expect(cutAfterTurn(events, 3)).toBe(6);
    expect(cutAfterTurn(events, 9)).toBe(6);
  });
});
