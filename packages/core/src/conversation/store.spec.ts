import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PromptLog } from '../wire/qwen-template.js';
import {
  ConversationStore,
  rebuildPromptLog,
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
      raw: '<think>hm</think>Salut !',
      thinking: true,
      at: '2026-08-18T10:00:05.000Z',
    });
    const events = await store.loadEvents('conv-1');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'user', text: 'Bonjour' });
    expect(events[1]).toMatchObject({ type: 'assistant', thinking: true });
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

  it('fige le prompt système et l’inventaire d’outils', async () => {
    const store = await makeStore();
    await store.create('conv-1');
    await store.freezeSystemPrompt('conv-1', 'SYS gelé', ['read_file']);
    const meta = await store.meta('conv-1');
    expect(meta.systemPrompt).toBe('SYS gelé');
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

describe('rebuildPromptLog', () => {
  it('reproduit un historique gelé OCTET-IDENTIQUE à la session d’origine', () => {
    const system = 'Tu es bonaparte.';
    const live = new PromptLog(system);
    const events: ConversationEvent[] = [];

    const script: Array<{ user: string; raw: string; thinking: boolean }> = [
      { user: 'Q1', raw: '<think>a</think>R1', thinking: true },
      { user: 'Q2', raw: 'R2', thinking: false },
      { user: 'Q3', raw: 'R3 avec <|détails|>', thinking: true },
    ];

    for (const turn of script) {
      live.appendUser(turn.user);
      events.push({ type: 'user', text: turn.user, at: 'x' });
      live.beginAssistantTurn({ thinking: turn.thinking });
      live.completeAssistantTurn(turn.raw);
      events.push({
        type: 'assistant',
        raw: turn.raw,
        thinking: turn.thinking,
        at: 'x',
      });
    }

    const rebuilt = rebuildPromptLog(system, events);
    expect(rebuilt.frozen).toBe(live.frozen);
  });

  it('rejoue un message de service comme un tour utilisateur', () => {
    const live = new PromptLog('SYS');
    live.appendUser('[inventaire modifié]');
    const rebuilt = rebuildPromptLog('SYS', [
      { type: 'service', text: '[inventaire modifié]', at: 'x' },
    ]);
    expect(rebuilt.frozen).toBe(live.frozen);
  });
});
