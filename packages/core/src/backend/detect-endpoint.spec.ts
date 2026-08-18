import { afterEach, describe, expect, it } from 'vitest';
import {
  startFakeLlamaServer,
  type FakeLlamaServer,
} from '../testing/fake-llama-server.js';
import {
  startFakeOpenAiServer,
  type FakeOpenAiServer,
} from '../testing/fake-openai-server.js';
import { probeEndpoint } from './detect-endpoint.js';

let llama: FakeLlamaServer[] = [];
let openai: FakeOpenAiServer[] = [];

afterEach(async () => {
  await Promise.all([...llama.map((s) => s.close()), ...openai.map((s) => s.close())]);
  llama = [];
  openai = [];
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

  it('reconnaît un endpoint OpenAI-compatible et liste ses modèles', async () => {
    const server = await startFakeOpenAiServer({
      replies: [{ text: 'x' }],
      model: 'qwen3-32b',
    });
    openai.push(server);

    const probe = await probeEndpoint(server.url);
    expect(probe).toMatchObject({
      protocol: 'openai-compat',
      models: ['qwen3-32b'],
      model: 'qwen3-32b',
    });
  });

  it('accepte une URL OpenAI collée sans le /v1', async () => {
    const server = await startFakeOpenAiServer({ replies: [{ text: 'x' }] });
    openai.push(server);

    const withoutV1 = server.url.replace(/\/v1$/, '');
    const probe = await probeEndpoint(withoutV1);
    expect(probe?.protocol).toBe('openai-compat');
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

  it('privilégie llama.cpp quand les deux façades répondent', async () => {
    // Un llama-server sert AUSSI /v1 : le détecter en OpenAI masquerait la
    // persistance de contexte, qui est justement ce qui le distingue.
    const server = await startFakeLlamaServer({});
    llama.push(server);
    expect((await probeEndpoint(server.url))?.protocol).toBe('llamacpp');
  });
});
