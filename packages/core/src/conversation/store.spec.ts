import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConversationStore,
  rebuildTranscript,
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