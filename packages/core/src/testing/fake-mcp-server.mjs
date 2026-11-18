#!/usr/bin/env node
/**
 * A fake MCP server over stdio — the fixture for everything that touches
 * MCP, as the fake llama-server is for the backend. Built on the official
 * SDK's low-level `Server`, with raw JSON Schemas: what a real server
 * sends, without a schema library.
 *
 * Tools:
 * - `echo` (read-only): answers with its `text`.
 * - `write_note` (no annotation): answers "noted: <text>".
 * - `fail`: answers with `isError`.
 * - `slow`: waits `ms` (default 10 s) — for cancellation; ends early on abort.
 * - `grow`: registers `extra` and announces `tools/list_changed`.
 * - `shout_env`: answers with the value of the env variable `FAKE_MCP_SECRET`.
 * - `crash`: the process exits — a server that dies mid-session.
 * - `pid`: answers its process id — to check nothing outlives a stop.
 *
 * `FAKE_MCP_PID_FILE=<path>` writes the process id there at start;
 * `FAKE_MCP_SLOW_START=<ms>` waits that long before answering anything.
 * `FAKE_MCP_FAIL_START=1` makes the process exit at once, with a message
 * on stderr — a server that cannot start. `FAKE_MCP_IGNORE_EOF=1` keeps it
 * alive after its stdin closes.
 */

import { writeFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFakeMcpServer } from './fake-mcp-tools.mjs';

// Where the process says who it is — a test checks nothing outlives a stop.
if (process.env.FAKE_MCP_PID_FILE) writeFileSync(process.env.FAKE_MCP_PID_FILE, String(process.pid));

if (process.env.FAKE_MCP_FAIL_START === '1') {
  process.stderr.write('fake-mcp: cannot start, missing configuration\n');
  process.exit(3);
}

// A server that does not exit when its stdin closes — some do not.
if (process.env.FAKE_MCP_IGNORE_EOF === '1') setInterval(() => undefined, 1_000);

// A server slow to answer its first message (a first npx download).
if (process.env.FAKE_MCP_SLOW_START) await new Promise((resolve) => setTimeout(resolve, Number(process.env.FAKE_MCP_SLOW_START)));

await createFakeMcpServer().connect(new StdioServerTransport());
