import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  startFakeLlamaServer,
  type FakeLlamaServer,
} from '../testing/fake-llama-server.js';
import { probeEndpoint } from './detect-endpoint.js';

let llama: FakeLlamaServer[] = [];
let others: Server[] = [];

/** Endpoint qui ne parle QUE l'API OpenAI : plus dans le périmètre. */
async function startOpenAiOnlyServer(): Promise<string> {
  const server = createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'qwen3-32b' }] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  others.push(server);
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('pas de port');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all([
    ...llama.map((s) => s.close()),
    ...others.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  ]);
  llama = [];
  others = [];
});

describe('probeEndpoint', () => {
  it('reconnaît un llama-server et rapporte son modèle et ses slots', async () => {
    const server = await startFakeLlamaServer({
      modelPath: 'D:\\models\\qwen3.gguf',
      totalSlots: 2,
    });
    llama.push(server);

    const probe = await probeEndpoint(server.url);
    expect(probe).toMatchObject({
      protocol: 'llamacpp',
      model: 'D:\\models\\qwen3.gguf',
      totalSlots: 2,
    });
  });

  it('ignore un endpoint qui ne parle que l’API OpenAI', async () => {
    // bonaparte ne pilote QUE llama.cpp : sa raison d'être est la persistance
    // du contexte, qu'aucune façade OpenAI n'expose. Reconnaître LM Studio ou
    // Ollama reviendrait à promettre une reprise instantanée impossible.
    const url = await startOpenAiOnlyServer();
    expect(await probeEndpoint(url)).toBeNull();
  });

  it('accepte une URL collée avec le /v1 de la façade OpenAI', async () => {
    // Un llama-server sert aussi /v1 : l'utilisateur peut coller cette racine.
    const server = await startFakeLlamaServer({});
    llama.push(server);

    const probe = await probeEndpoint(`${server.url}/v1`);
    expect(probe?.protocol).toBe('llamacpp');
    expect(probe?.baseUrl).toBe(server.url);
  });

  it('tolère une barre oblique finale', async () => {
    const server = await startFakeLlamaServer({});
    llama.push(server);
    expect((await probeEndpoint(`${server.url}/`))?.protocol).toBe('llamacpp');
  });

  it('rend null quand rien ne répond', async () => {
    expect(await probeEndpoint('http://127.0.0.1:1')).toBeNull();
  });

  it('rend null sur une URL vide', async () => {
    expect(await probeEndpoint('   ')).toBeNull();
  });
});
