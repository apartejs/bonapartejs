import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

/** A fake MCP server with its own tool list — see fake-mcp-tools.mjs. */
export function createFakeMcpServer(options?: { endlessPages?: boolean }): Server;
