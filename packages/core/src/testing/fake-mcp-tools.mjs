/**
 * The fake MCP server's tools, shared by its stdio entry
 * (`fake-mcp-server.mjs`) and the streamable HTTP helper of the specs.
 * Each call to `createFakeMcpServer` has its own tool list (`grow` adds to
 * it) — one server per connection, as a real one would be.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/** `options.endlessPages`: every page of tools announces another — a server that never ends its list. */
export function createFakeMcpServer(options = {}) {
  const text = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };

  const tools = [
    {
      name: 'echo',
      description: 'Echoes the text back.',
      inputSchema: text,
      annotations: { readOnlyHint: true },
    },
    { name: 'write_note', description: 'Writes a note.', inputSchema: text },
    { name: 'fail', description: 'Always fails.', inputSchema: { type: 'object', properties: {} } },
    {
      name: 'slow',
      description: 'Takes its time.',
      inputSchema: { type: 'object', properties: { ms: { type: 'number' } } },
    },
    { name: 'grow', description: 'Adds a tool.', inputSchema: { type: 'object', properties: {} } },
    { name: 'shout_env', description: 'Reads FAKE_MCP_SECRET.', inputSchema: { type: 'object', properties: {} } },
    { name: 'crash', description: 'Stops the process (stdio only).', inputSchema: { type: 'object', properties: {} } },
    { name: 'pid', description: 'Answers its process id.', inputSchema: { type: 'object', properties: {} } },
  ];

  const server = new Server(
    { name: 'fake-mcp', version: '1.0.0' },
    { capabilities: { tools: { listChanged: true } } },
  );

  let page = 0;
  server.setRequestHandler(ListToolsRequestSchema, async () =>
    options.endlessPages
      ? { tools: [{ name: `page_${++page}`, description: 'x', inputSchema: { type: 'object', properties: {} } }], nextCursor: 'again' }
      : { tools },
  );

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const args = request.params.arguments ?? {};
    switch (request.params.name) {
      case 'echo':
        return { content: [{ type: 'text', text: String(args.text ?? '') }] };
      case 'write_note':
        return { content: [{ type: 'text', text: `noted: ${String(args.text ?? '')}` }] };
      case 'fail':
        return { isError: true, content: [{ type: 'text', text: 'it went wrong' }] };
      case 'slow': {
        const ms = typeof args.ms === 'number' ? args.ms : 10_000;
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, ms);
          extra.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve(undefined);
          });
        });
        return { content: [{ type: 'text', text: 'slow done' }] };
      }
      case 'grow':
        if (!tools.some((tool) => tool.name === 'extra')) {
          tools.push({ name: 'extra', description: 'Appeared later.', inputSchema: { type: 'object', properties: {} } });
        }
        await server.sendToolListChanged();
        return { content: [{ type: 'text', text: 'grown' }] };
      case 'pid':
        return { content: [{ type: 'text', text: String(process.pid) }] };
      case 'crash':
        setTimeout(() => process.exit(1), 10);
        return { content: [{ type: 'text', text: 'bye' }] };
      case 'shout_env':
        return { content: [{ type: 'text', text: String(process.env.FAKE_MCP_SECRET ?? '(unset)') }] };
      case 'extra':
        return {
          content: [
            { type: 'text', text: 'first part' },
            { type: 'image', data: 'AAAA', mimeType: 'image/png' },
            { type: 'text', text: 'second part' },
          ],
        };
      default:
        return { isError: true, content: [{ type: 'text', text: `unknown tool ${request.params.name}` }] };
    }
  });
  return server;
}
