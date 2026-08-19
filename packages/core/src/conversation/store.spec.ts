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
  it('rattache le projet à la conversation, pas à l’application', async () => {
    // Le projet appartient à la conversation : deux conversations ouvertes
    // sur deux dossiers différents doivent coexister sans se marcher dessus.
    const store = await makeStore();
    await store.create('a', { projectRoot: '/projets/alpha' });
    await store.create('b', { projectRoot: '/projets/beta' });

    expect((await store.meta('a')).projectRoot).toBe('/projets/alpha');
    expect((await store.meta('b')).projectRoot).toBe('/projets/beta');
  });

  it('une conversation sans projet reste licite', async () => {
    const store = await makeStore();
    await store.create('libre');
    expect((await store.meta('libre')).projectRoot).toBeUndefined();
  });

  it('setProjectRoot attache un dossier après coup', async () => {
    const store = await makeStore();
    await store.create('c');
    await store.setProjectRoot('c', '/projets/gamma');
    expect((await store.meta('c')).projectRoot).toBe('/projets/gamma');
  });

  it('setSetting pose puis retire une surcharge de conversation', async () => {
    const store = await makeStore();
    await store.create('s');
    await store.setSetting('s', 'temperature', 0.2);
    expect((await store.meta('s')).settings).toEqual({ temperature: 0.2 });

    // undefined = revenir à l'héritage, pas stocker un trou.
    await store.setSetting('s', 'temperature', undefined);
    expect((await store.meta('s')).settings).toEqual({});
  });

  it('setTitle renomme sans toucher au reste', async () => {
    const store = await makeStore();
    await store.create('d', { title: 'Sans titre', projectRoot: '/projets/delta' });
    await store.setTitle('d', 'Refonte du parser');
    const meta = await store.meta('d');
    expect(meta.title).toBe('Refonte du parser');
    expect(meta.projectRoot).toBe('/projets/delta');
  });

  it('create puis listMeta expose la conversation', async () => {
    const store = await makeStore();
    await store.create('conv-1', { title: 'Ma conversation' });
    const metas = await store.listMeta();
    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({ id: 'conv-1', title: 'Ma conversation' });
    expect(await store.exists('conv-1')).toBe(true);
    expect(await store.exists('fantome')).toBe(false);
  });

  it('appendEvent + loadEvents restituent le log dans l’ordre', async () => {
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

  it('loadEvents sur une conversation inconnue lève une erreur claire', async () => {
    const store = await makeStore();
    await expect(store.loadEvents('fantome')).rejects.toThrow(/fantome/);
  });

  it('épingle le modèle ET la taille de contexte à la création', async () => {
    const store = await makeStore();
    await store.create('conv-1', { modelPath: 'D:\\models\\qwen3.gguf', nCtx: 32768 });
    const meta = await store.meta('conv-1');
    expect(meta.modelPath).toBe('D:\\models\\qwen3.gguf');
    expect(meta.nCtx).toBe(32768);
  });

  it('setModel pose modèle + nCtx sur une conversation qui n’en avait pas', async () => {
    const store = await makeStore();
    await store.create('conv-1');
    expect((await store.meta('conv-1')).modelPath).toBeUndefined();
    await store.setModel('conv-1', 'D:\\models\\qwen3.gguf', 16384);
    const meta = await store.meta('conv-1');
    expect(meta.modelPath).toBe('D:\\models\\qwen3.gguf');
    expect(meta.nCtx).toBe(16384);
  });

  it('fige l’état backend et l’inventaire d’outils', async () => {
    const store = await makeStore();
    await store.create('conv-1');
    await store.freezeBackendState('conv-1', { systemPrompt: 'SYS gelé' }, [
      'read_file',
    ]);
    const meta = await store.meta('conv-1');
    expect(meta.backendState).toEqual({ systemPrompt: 'SYS gelé' });
    expect(meta.toolNames).toEqual(['read_file']);
  });

  it('meta lève une erreur claire pour une conversation inconnue', async () => {
    const store = await makeStore();
    await expect(store.meta('fantome')).rejects.toThrow(/fantome/);
  });

  it('appendEvent met à jour updatedAt', async () => {
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
  it('restitue le transcript sémantique depuis les événements persistés', () => {
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