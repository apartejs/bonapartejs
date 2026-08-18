import { afterEach, describe, expect, it } from 'vitest';
import {
  fakeTokenize,
  startFakeLlamaServer,
  type FakeLlamaServer,
} from './fake-llama-server.js';

let servers: FakeLlamaServer[] = [];

async function start(
  ...args: Parameters<typeof startFakeLlamaServer>
): Promise<FakeLlamaServer> {
  const server = await startFakeLlamaServer(...args);
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

/** POST /completion en stream et agrège les événements SSE data: {...}. */
async function complete(
  server: FakeLlamaServer,
  body: Record<string, unknown>,
): Promise<{ content: string; final: Record<string, any> }> {
  const res = await fetch(`${server.url}/completion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stream: true, ...body }),
  });
  expect(res.ok).toBe(true);
  const text = await res.text();
  const events = text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)));
  const final = events.at(-1);
  if (!final?.stop) throw new Error('dernier événement sans stop:true');
  return {
    content: events.map((e) => e.content ?? '').join(''),
    final,
  };
}

async function slotAction(
  server: FakeLlamaServer,
  idSlot: number,
  action: string,
  filename?: string,
): Promise<{ status: number; body: Record<string, any> }> {
  const res = await fetch(`${server.url}/slots/${idSlot}?action=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: filename ? JSON.stringify({ filename }) : '{}',
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('fake llama-server', () => {
  it('répond ok sur /health', async () => {
    const server = await start();
    const res = await fetch(`${server.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('expose model_path et total_slots sur /props', async () => {
    const server = await start({ modelPath: 'D:\\models\\qwen.gguf', totalSlots: 2 });
    const res = await fetch(`${server.url}/props`);
    const props = (await res.json()) as Record<string, any>;
    expect(props['model_path']).toBe('D:\\models\\qwen.gguf');
    expect(props['total_slots']).toBe(2);
  });

  it('streame la réponse en SSE et termine par stop:true', async () => {
    const server = await start({ responder: () => 'bonjour de bonaparte' });
    const { content, final } = await complete(server, { prompt: 'salut' });
    expect(content).toBe('bonjour de bonaparte');
    expect(final['stop']).toBe(true);
    expect(final['timings']).toBeDefined();
  });

  it('facture le prefill au prorata des tokens non cachés (premier appel = tout)', async () => {
    const server = await start({ msPerToken: 10 });
    const prompt = 'x'.repeat(40); // 10 tokens de 4 chars
    const { final } = await complete(server, { prompt });
    expect(final['timings']['prompt_ms']).toBe(100);
  });

  it('réutilise le cache du slot : un préfixe déjà vu ne se re-paie pas', async () => {
    const server = await start({ msPerToken: 10 });
    const prefix = 'x'.repeat(40);
    await complete(server, { prompt: prefix, id_slot: 0 });
    const { final } = await complete(server, {
      prompt: prefix + 'y'.repeat(8), // +2 tokens
      id_slot: 0,
    });
    expect(final['timings']['prompt_ms']).toBe(20);
  });

  it('rapporte prompt_progress quand return_progress est demandé', async () => {
    const server = await start();
    const prefix = 'x'.repeat(40);
    await complete(server, { prompt: prefix, id_slot: 0 });
    const { final } = await complete(server, {
      prompt: prefix + 'y'.repeat(8),
      id_slot: 0,
      return_progress: true,
    });
    const progress = final['prompt_progress'];
    expect(progress['total']).toBe(12);
    expect(progress['cache']).toBe(10);
    expect(progress['processed']).toBe(12);
  });

  it('sauvegarde le cache du slot dans un fichier nommé (n_saved, n_written)', async () => {
    // responder vide : le cache du slot = les tokens du prompt uniquement
    // (le vrai serveur garde prompt + génération ; ici on fige le comptage).
    const server = await start({ responder: () => '' });
    const prompt = 'x'.repeat(40);
    await complete(server, { prompt, id_slot: 0 });
    const { status, body } = await slotAction(server, 0, 'save', 'conv-1.slot');
    expect(status).toBe(200);
    expect(body['id_slot']).toBe(0);
    expect(body['filename']).toBe('conv-1.slot');
    expect(body['n_saved']).toBe(fakeTokenize(prompt).length);
    expect(body['n_written']).toBeGreaterThan(0);
    expect(server.files.has('conv-1.slot')).toBe(true);
  });

  it('restaure un état sauvé après « redémarrage » (mêmes fichiers, nouveau process)', async () => {
    const disk = new Map();
    const first = await start({ msPerToken: 10, files: disk, responder: () => '' });
    const prompt = 'x'.repeat(400); // 100 tokens
    await complete(first, { prompt, id_slot: 0 });
    await slotAction(first, 0, 'save', 'conv-1.slot');
    await first.close();

    const second = await start({ msPerToken: 10, files: disk, responder: () => '' });
    const restore = await slotAction(second, 0, 'restore', 'conv-1.slot');
    expect(restore.status).toBe(200);
    expect(restore.body['n_restored']).toBe(100);

    const { final } = await complete(second, {
      prompt: prompt + 'y'.repeat(8),
      id_slot: 0,
    });
    expect(final['timings']['prompt_ms']).toBe(20); // 2 tokens seulement
  });

  it('erase vide le cache du slot (n_erased) et le prefill se re-paie', async () => {
    const server = await start({ msPerToken: 10, responder: () => '' });
    const prompt = 'x'.repeat(40);
    await complete(server, { prompt, id_slot: 0 });
    const { body } = await slotAction(server, 0, 'erase');
    expect(body['n_erased']).toBe(10);
    const { final } = await complete(server, { prompt, id_slot: 0 });
    expect(final['timings']['prompt_ms']).toBe(100);
  });

  it('répond 400 quand le fichier à restaurer est inconnu', async () => {
    const server = await start();
    const { status } = await slotAction(server, 0, 'restore', 'inconnu.slot');
    expect(status).toBe(400);
  });

  it('des slots distincts ont des caches indépendants', async () => {
    const server = await start({ msPerToken: 10, totalSlots: 2 });
    const prompt = 'x'.repeat(40);
    await complete(server, { prompt, id_slot: 0 });
    const { final } = await complete(server, { prompt, id_slot: 1 });
    expect(final['timings']['prompt_ms']).toBe(100); // slot 1 n'a rien en cache
  });

  it('GET /slots reflète l’état des slots', async () => {
    const server = await start({ totalSlots: 2 });
    await complete(server, { prompt: 'x'.repeat(16), id_slot: 1 });
    const res = await fetch(`${server.url}/slots`);
    const slots = (await res.json()) as Array<Record<string, any>>;
    expect(slots).toHaveLength(2);
    expect(slots[1]?.['n_ctx_used']).toBeGreaterThan(0);
  });
});
