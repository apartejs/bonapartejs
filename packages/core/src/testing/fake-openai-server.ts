/**
 * A fake service that speaks OpenAI's API (task 9.2): `/v1/models`, and `/v1/chat/completions` streamed as
 * Server-Sent Events — text, or tool calls in OpenAI's delta shape. What a test reads: every request it was
 * sent (its messages, its tools, its authorization), and what it answered.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeChatMessage {
  role: string;
  content?: unknown;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

export interface FakeChatRequest {
  model: string;
  messages: FakeChatMessage[];
  tools?: { type: 'function'; function: { name: string; description?: string; parameters?: unknown } }[];
  authorization: string | undefined;
}

/** What the service answers a request: words, or calls of tools. */
export interface FakeOpenAIAnswer {
  text?: string;
  calls?: { name: string; arguments: Record<string, unknown> }[];
}

export interface FakeOpenAIServerOptions {
  models?: string[];
  /** The key the service asks; without it, any request (or none) is accepted. */
  key?: string;
  /** Answers at once, or when its promise settles (a service that thinks for a while). */
  responder?: (request: FakeChatRequest) => FakeOpenAIAnswer | Promise<FakeOpenAIAnswer>;
  /** A real delay between two chunks (default 0). */
  paceMs?: number;
}

export interface FakeOpenAIServer {
  url: string;
  requests: FakeChatRequest[];
  /** The answers whose client went away before their end: a Stop that reached the service. */
  readonly aborted: number;
  close(): Promise<void>;
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

export async function startFakeOpenAIServer(options: FakeOpenAIServerOptions = {}): Promise<FakeOpenAIServer> {
  const requests: FakeChatRequest[] = [];
  const models = options.models ?? ['fake-model'];
  let calls = 0;
  let aborted = 0;
  const server: Server = createServer((req, res) => {
    void (async () => {
      const authorization = req.headers.authorization;
      if (options.key && authorization !== `Bearer ${options.key}`) return json(res, 401, { error: { message: 'Invalid API key.' } });
      if (req.method === 'GET' && req.url === '/v1/models') {
        return json(res, 200, { object: 'list', data: models.map((id) => ({ id, object: 'model' })) });
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        const body = JSON.parse(await readBody(req)) as Omit<FakeChatRequest, 'authorization'>;
        const request: FakeChatRequest = { model: body.model, messages: body.messages, ...(body.tools ? { tools: body.tools } : {}), authorization };
        requests.push(request);
        const answer = (await options.responder?.(request)) ?? { text: 'ok' };
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.on('close', () => {
          if (!res.writableFinished) aborted += 1;
        });
        const send = async (chunk: unknown): Promise<void> => {
          // The client went away: the answer ends here, as a service's does.
          if (res.destroyed) throw new Error('The client went away.');
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          if (options.paceMs) await new Promise((resolve) => setTimeout(resolve, options.paceMs));
        };
        const base = { id: `chatcmpl-${requests.length}`, object: 'chat.completion.chunk', created: 0, model: body.model };
        await send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
        for (const piece of (answer.text ?? '').split(/(?<= )/).filter(Boolean)) {
          await send({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
        }
        for (const [index, call] of (answer.calls ?? []).entries()) {
          calls += 1;
          await send({
            ...base,
            choices: [
              {
                index: 0,
                delta: { tool_calls: [{ index, id: `call_${calls}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] },
                finish_reason: null,
              },
            ],
          });
        }
        const prompt = JSON.stringify(body.messages).length;
        await send({
          ...base,
          choices: [{ index: 0, delta: {}, finish_reason: answer.calls?.length ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: Math.ceil(prompt / 4), completion_tokens: Math.ceil((answer.text ?? '').length / 4), total_tokens: 0 },
        });
        res.end('data: [DONE]\n\n');
        return;
      }
      json(res, 404, { error: { message: 'Not found.' } });
    })().catch((error: unknown) => json(res, 500, { error: { message: String(error) } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    requests,
    get aborted() {
      return aborted;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return void res.end();
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
