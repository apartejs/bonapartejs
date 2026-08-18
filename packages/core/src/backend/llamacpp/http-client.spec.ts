import { afterEach, describe, expect, it } from 'vitest';
import {
  startFakeLlamaServer,
  type FakeLlamaServer,
} from '../../testing/fake-llama-server.js';
import type { CompletionEvent, CompletionStats } from '../types.js';
import { LlamaCppHttpClient, LlamaCppHttpError } from './http-client.js';

let servers: FakeLlamaServer[] = [];

async function startServer(
  ...args: Parameters<typeof startFakeLlamaServer>
): Promise<{ server: FakeLlamaServer; client: LlamaCppHttpClient }> {
  const server = await startFakeLlamaServer(...args);
  servers.push(server);
  return { server, client: new LlamaCppHttpClient(server.url) };
}

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

async function collect(
  events: AsyncIterable<CompletionEvent>,
): Promise<{ text: string; stats: CompletionStats }> {
  let text = '';
  let stats: CompletionStats | null = null;
  for await (const event of events) {
    if (event.type === 'token') text += event.text;
    else stats = event.stats;
  }
  if (!stats) throw new Error('aucun événement done');
  return { text, stats };
}

describe('LlamaCppHttpClient', () => {
  it('health() reflète la disponibilité du serveur', async () => {
    const { client } = await startServer();
    expect(await client.health()).toBe(true);
    const down = new LlamaCppHttpClient('http://127.0.0.1:1');
    expect(await down.health()).toBe(false);
  });

  it('props() remonte modelPath et totalSlots', async () => {
    const { client } = await startServer({
      modelPath: 'D:\\models\\qwen3.gguf',
      totalSlots: 4,
    });
    const props = await client.props();
    expect(props.modelPath).toBe('D:\\models\\qwen3.gguf');
    expect(props.totalSlots).toBe(4);
  });

  it('complete() streame les tokens puis les stats finales', async () => {
    const { client } = await startServer({
      responder: () => 'bonjour le monde',
      msPerToken: 5,
    });
    const { text, stats } = await collect(
      client.complete({ prompt: 'x'.repeat(20) }),
    );
    expect(text).toBe('bonjour le monde');
    expect(stats.promptMs).toBe(25); // 5 tokens × 5 ms
    expect(stats.predictedTokens).toBeGreaterThan(0);
  });

  it('complete() cible un slot et profite de son cache', async () => {
    const { client } = await startServer({ msPerToken: 10, responder: () => '' });
    const prefix = 'x'.repeat(40);
    const first = await collect(client.complete({ prompt: prefix, idSlot: 0 }));
    expect(first.stats.promptMs).toBe(100);
    const second = await collect(
      client.complete({ prompt: prefix + 'y'.repeat(8), idSlot: 0 }),
    );
    expect(second.stats.promptMs).toBe(20);
  });

  it('complete() remonte prompt_progress quand demandé', async () => {
    const { client } = await startServer({ responder: () => '' });
    const prefix = 'x'.repeat(40);
    await collect(client.complete({ prompt: prefix, idSlot: 0 }));
    const { stats } = await collect(
      client.complete({
        prompt: prefix + 'y'.repeat(8),
        idSlot: 0,
        returnProgress: true,
      }),
    );
    expect(stats.progress).toEqual({
      total: 12,
      cache: 10,
      processed: 12,
      timeMs: stats.promptMs,
    });
  });

  it('saveSlot/restoreSlot font le cycle complet à travers un redémarrage', async () => {
    const disk = new Map();
    const { server, client } = await startServer({
      files: disk,
      msPerToken: 10,
      responder: () => '',
    });
    const prompt = 'x'.repeat(400);
    await collect(client.complete({ prompt, idSlot: 0 }));

    const saved = await client.saveSlot(0, 'conv-42.slot');
    expect(saved).toMatchObject({ idSlot: 0, filename: 'conv-42.slot', nSaved: 100 });
    expect(saved.nWritten).toBeGreaterThan(0);
    await server.close();

    const { client: client2 } = await startServer({
      files: disk,
      msPerToken: 10,
      responder: () => '',
    });
    const restored = await client2.restoreSlot(0, 'conv-42.slot');
    expect(restored).toMatchObject({ idSlot: 0, nRestored: 100 });

    const { stats } = await collect(
      client2.complete({ prompt: prompt + 'y'.repeat(8), idSlot: 0 }),
    );
    expect(stats.promptMs).toBe(20);
  });

  it('eraseSlot retourne le nombre de tokens effacés', async () => {
    const { client } = await startServer({ responder: () => '' });
    await collect(client.complete({ prompt: 'x'.repeat(40), idSlot: 0 }));
    expect(await client.eraseSlot(0)).toBe(10);
  });

  it('restoreSlot lève LlamaCppHttpError(400) sur fichier inconnu', async () => {
    const { client } = await startServer();
    await expect(client.restoreSlot(0, 'inconnu.slot')).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlamaCppHttpError && err.status === 400,
    );
  });

  it('complete() rejette immédiatement si le signal est déjà annulé', async () => {
    const { client } = await startServer();
    const controller = new AbortController();
    controller.abort();
    await expect(
      collect(client.complete({ prompt: 'x', signal: controller.signal })),
    ).rejects.toThrow();
  });
});
