/**
 * Faux endpoint OpenAI-compatible — la fixture qui tient lieu de LM Studio en
 * CI (même rôle que le faux llama-server). Elle sert `/v1/models` et
 * `/v1/chat/completions` en SSE, avec des tool-calls au format natif OpenAI,
 * fragmentés comme le fait un vrai serveur.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';

export interface FakeOpenAiReply {
  text?: string;
  calls?: { name: string; arguments: Record<string, unknown> }[];
}

export interface FakeOpenAiServerOptions {
  replies: FakeOpenAiReply[];
  model?: string;
}

export interface FakeOpenAiServer {
  url: string;
  /** Corps reçus, pour vérifier le mapping transcript → messages. */
  requests: Record<string, unknown>[];
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

export async function startFakeOpenAiServer(
  options: FakeOpenAiServerOptions,
): Promise<FakeOpenAiServer> {
  const model = options.model ?? 'fake-model';
  const requests: Record<string, unknown>[] = [];
  let turn = 0;

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: model }] }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
        requests.push(await readBody(req));
        const reply = options.replies[Math.min(turn++, options.replies.length - 1)] ?? {};

        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        });
        const send = (delta: unknown): void => {
          res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
        };

        for (const piece of (reply.text ?? '').match(/.{1,6}/gs) ?? []) {
          send({ content: piece });
        }
        // Les arguments arrivent fragmentés, comme sur un vrai serveur, et le
        // premier fragment porte l'id de l'appel.
        (reply.calls ?? []).forEach((call, index) => {
          send({
            tool_calls: [
              {
                index,
                id: `call_${index}`,
                function: { name: call.name, arguments: '' },
              },
            ],
          });
          const args = JSON.stringify(call.arguments);
          const half = Math.ceil(args.length / 2);
          send({
            tool_calls: [{ index, function: { arguments: args.slice(0, half) } }],
          });
          send({
            tool_calls: [{ index, function: { arguments: args.slice(half) } }],
          });
        });
        // Chunk de fin de tour : c'est LUI qui dit au client que les appels
        // sont complets. L'omettre rendait la fixture plus permissive qu'un
        // vrai serveur, et masquait les clients trop laxistes.
        res.write(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {},
                finish_reason: (reply.calls ?? []).length > 0 ? 'tool_calls' : 'stop',
              },
            ],
          })}\n\n`,
        );
        // Chunk d'usage final, comme un vrai serveur avec include_usage.
        res.write(
          `data: ${JSON.stringify({
            choices: [],
            usage: {
              prompt_tokens: 120,
              completion_tokens: 7,
              total_tokens: 127,
              prompt_tokens_details: { cached_tokens: 100 },
            },
          })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
