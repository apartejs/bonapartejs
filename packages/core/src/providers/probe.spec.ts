/**
 * What answers at an address (task 9.1): a llama-server (its `/props`), a service that speaks OpenAI's API (its
 * `/v1/models`), or nothing a person can use — said in a few seconds, never left hanging.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { probeEndpoint } from './probe.js';

const servers: Server[] = [];

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

const json = (res: import('node:http').ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

describe('probing an address', () => {
  it('a llama-server: its model and its slots, from /props', async () => {
    const url = await serve((req, res) => {
      if (req.url === '/props') return json(res, 200, { model_path: '/models/gemma-4-26B.gguf', total_slots: 2 });
      json(res, 404, {});
    });
    await expect(probeEndpoint(`${url}/`)).resolves.toEqual({ kind: 'llamacpp-remote', url, models: ['gemma-4-26B.gguf'], totalSlots: 2 });
    // Its OpenAI face, pasted by habit, leads to the same server.
    await expect(probeEndpoint(`${url}/v1`)).resolves.toMatchObject({ kind: 'llamacpp-remote', url });
  });

  it("a service that speaks OpenAI's API: its models, at the address given", async () => {
    const seen: (string | undefined)[] = [];
    const url = await serve((req, res) => {
      seen.push(req.headers.authorization);
      if (req.url === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: 'qwen3:8b' }, { id: 'gemma3:4b' }] });
      json(res, 404, {});
    });
    await expect(probeEndpoint(`${url}/v1`, { key: 'sk-test' })).resolves.toEqual({
      kind: 'openai-compat',
      url: `${url}/v1`,
      models: ['qwen3:8b', 'gemma3:4b'],
    });
    expect(seen.every((header) => header === 'Bearer sk-test')).toBe(true);
    // Without « /v1 », the service is found at its usual root all the same.
    await expect(probeEndpoint(url)).resolves.toMatchObject({ kind: 'openai-compat', url: `${url}/v1` });
  });

  it('a key refused: said as such', async () => {
    const url = await serve((_req, res) => json(res, 401, { error: { message: 'invalid api key' } }));
    await expect(probeEndpoint(`${url}/v1`, { key: 'wrong' })).resolves.toMatchObject({ error: 'refused-key' });
  });

  it('an address that answers nothing a person can use: said as such', async () => {
    const url = await serve((_req, res) => json(res, 200, { hello: 'world' }));
    await expect(probeEndpoint(url)).resolves.toMatchObject({ error: 'not-a-service' });
  });

  it('nothing listens: said at once', async () => {
    const url = await serve(() => undefined);
    const port = new URL(url).port;
    for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
    await expect(probeEndpoint(`http://127.0.0.1:${port}`)).resolves.toMatchObject({ error: 'unreachable' });
  });

  it('a silent address: said in under five seconds', async () => {
    const url = await serve(() => undefined);
    const started = Date.now();
    await expect(probeEndpoint(url)).resolves.toMatchObject({ error: 'timeout' });
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 10_000);

  it('not an address: said as such, nothing asked', async () => {
    await expect(probeEndpoint('localhost 11434')).resolves.toMatchObject({ error: 'invalid-address' });
    await expect(probeEndpoint('file:///etc/passwd')).resolves.toMatchObject({ error: 'invalid-address' });
  });
});
