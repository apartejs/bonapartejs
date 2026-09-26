/**
 * The fake MCP server over streamable HTTP, in process — the same tools as
 * the stdio fake, one server per session, as a real one would have. With
 * `token`, a request without `Authorization: Bearer <token>` is refused.
 */

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createFakeMcpServer } from './fake-mcp-tools.mjs';

export interface FakeMcpHttpServer {
  url: string;
  close(): Promise<void>;
}

export async function startFakeMcpHttpServer(options: { token?: string } = {}): Promise<FakeMcpHttpServer> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const http = createServer((req, res) => {
    void (async () => {
      if (options.token && req.headers.authorization !== `Bearer ${options.token}`) {
        res.writeHead(401).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body: unknown = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      const sessionId = req.headers['mcp-session-id'];
      let transport = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
      if (!transport) {
        const created: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, created);
          },
        });
        await createFakeMcpServer().connect(created);
        transport = created;
      }
      await transport.handleRequest(req, res, body);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      await Promise.all([...sessions.values()].map((transport) => transport.close().catch(() => undefined)));
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
