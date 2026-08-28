import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  startFakeLlamaServer,
  type FakeLlamaServer,
} from '../testing/fake-llama-server.js';
import { probeEndpoint } from './detect-endpoint.js';

let llama: FakeLlamaServer[] = [];
let others: Server[] = [];

/** Endpoint that speaks ONLY the OpenAI API: no longer in scope. */
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
  if (typeof address === 'string' || address === null) throw new Error('no port');
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
  it('recognizes a llama-server and reports its model and slots', async () => {
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

  it('ignores an endpoint that speaks only the OpenAI API', async () => {
    // bonaparte drives ONLY llama.cpp: its reason for being is context
    // persistence, which no OpenAI facade exposes. Recognizing LM Studio or
    // Ollama would amount to promising an impossible instant resume.
    const url = await startOpenAiOnlyServer();
    expect(await probeEndpoint(url)).toBeNull();
  });

  it('accepts a URL pasted with the OpenAI facade’s /v1', async () => {
    // A llama-server also serves /v1: the user might paste that root.
    const server = await startFakeLlamaServer({});
    llama.push(server);

    const probe = await probeEndpoint(`${server.url}/v1`);
    expect(probe?.protocol).toBe('llamacpp');
    expect(probe?.baseUrl).toBe(server.url);
  });

  it('tolerates a trailing slash', async () => {
    const server = await startFakeLlamaServer({});
    llama.push(server);
    expect((await probeEndpoint(`${server.url}/`))?.protocol).toBe('llamacpp');
  });

  it('returns null when nothing responds', async () => {
    expect(await probeEndpoint('http://127.0.0.1:1')).toBeNull();
  });

  it('returns null for an empty URL', async () => {
    expect(await probeEndpoint('   ')).toBeNull();
  });
});
