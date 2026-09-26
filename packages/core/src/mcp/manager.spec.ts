/**
 * McpClientManager (P4.1): one client per configured server, its tools in
 * the single registry — named after the server, sourced `mcp` — so they
 * reach the grammar and the prompt like any other, and go through the
 * permission modes (P4.3). A server that adds tools says so and the
 * registry follows; one that fails, or dies, is reported with what it said,
 * and its tools leave. Tested against a fake MCP server, over stdio and
 * over streamable HTTP.
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeMcpHttpServer, type FakeMcpHttpServer } from '../testing/fake-mcp-http.js';
import { MAX_TOOL_OUTPUT_CHARS } from '../tools/builtin/index.js';
import { ToolRegistry } from '../tools/registry.js';
import type { ToolContext } from '../tools/types.js';
import type { McpServerConfig } from './config.js';
import { McpClientManager, mcpToolName } from './manager.js';

const FAKE = fileURLToPath(new URL('../testing/fake-mcp-server.mjs', import.meta.url));

const stdio = (id: string, extra: Partial<Extract<McpServerConfig, { transport: 'stdio' }>> = {}): McpServerConfig => ({
  id,
  transport: 'stdio',
  command: process.execPath,
  args: [FAKE],
  disabled: false,
  ...extra,
});

const managers: McpClientManager[] = [];
const https: FakeMcpHttpServer[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.stopAll()));
  await Promise.all(https.splice(0).map((server) => server.close()));
});

function rig(): { manager: McpClientManager; registry: ToolRegistry; changes: () => number } {
  const registry = new ToolRegistry();
  let changes = 0;
  const manager = new McpClientManager({ registry, onChange: () => changes++, clientVersion: '0.0.0-test' });
  managers.push(manager);
  return { manager, registry, changes: () => changes };
}

const ctx = (signal = new AbortController().signal): ToolContext => ({ roots: [], signal });

async function call(registry: ToolRegistry, name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) {
  const tool = registry.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.handler(args, ctx(signal));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(predicate: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('McpClientManager — stdio', () => {
  it('connects a server and registers its tools, named after it, as MCP tools', async () => {
    const { manager, registry, changes } = await rig();

    await manager.apply([stdio('fake')]);

    const status = manager.status();
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({ id: 'fake', transport: 'stdio', state: 'connected' });
    expect(status[0]?.tools).toEqual(expect.arrayContaining(['echo', 'write_note', 'fail']));
    const echo = registry.get('mcp__fake__echo');
    expect(echo?.source).toBe('mcp');
    expect(echo?.def.description).toContain('Echoes the text back.');
    expect(echo?.def.inputSchema).toMatchObject({ type: 'object', properties: { text: { type: 'string' } } });
    // P4.3: a server's word is a hint. Read-only reaches out all the same
    // (`network`); anything else runs something (`execute`).
    expect(echo?.def.effect).toBe('network');
    expect(registry.get('mcp__fake__write_note')?.def.effect).toBe('execute');
    expect(changes()).toBeGreaterThan(0);
  });

  it('a call answers with the tool’s text; an error result is a failed call', async () => {
    const { manager, registry } = await rig();
    await manager.apply([stdio('fake')]);

    expect(await call(registry, 'mcp__fake__echo', { text: 'hello' })).toEqual({ ok: true, content: 'hello' });
    expect(await call(registry, 'mcp__fake__fail')).toEqual({ ok: false, content: 'it went wrong' });
  });

  it('a server that adds a tool says so — the registry follows, and what is not text is named', async () => {
    const { manager, registry, changes } = await rig();
    await manager.apply([stdio('fake')]);
    const before = changes();

    await call(registry, 'mcp__fake__grow');
    await until(() => registry.get('mcp__fake__extra') !== undefined);

    expect(changes()).toBeGreaterThan(before);
    expect(manager.status()[0]?.tools).toContain('extra');
    const result = await call(registry, 'mcp__fake__extra');
    expect(result.content).toBe('first part\n[image/png image omitted]\nsecond part');
  });

  it('passes its environment to the server', async () => {
    const { manager, registry } = await rig();
    await manager.apply([stdio('fake', { env: { FAKE_MCP_SECRET: 's3cret' } })]);
    expect((await call(registry, 'mcp__fake__shout_env')).content).toBe('s3cret');
  });

  it('a server that cannot start is failed, with what it said — and the others still load', async () => {
    const { manager, registry } = await rig();

    await manager.apply([stdio('broken', { env: { FAKE_MCP_FAIL_START: '1' } }), stdio('fake')]);

    const broken = manager.status().find((server) => server.id === 'broken');
    expect(broken?.state).toBe('failed');
    expect(broken?.error).toContain('cannot start, missing configuration');
    expect(registry.list().some((tool) => tool.name.startsWith('mcp__broken__'))).toBe(false);
    expect(registry.get('mcp__fake__echo')).toBeDefined();
  });

  it('a switched-off server is listed, and never started', async () => {
    const { manager, registry } = await rig();
    await manager.apply([stdio('fake', { disabled: true })]);
    expect(manager.status()).toEqual([expect.objectContaining({ id: 'fake', state: 'off', tools: [] })]);
    expect(registry.list()).toEqual([]);
  });

  it('a server gone from the config stops, and its tools leave', async () => {
    const { manager, registry, changes } = await rig();
    await manager.apply([stdio('fake')]);
    const before = changes();

    await manager.apply([]);

    expect(manager.status()).toEqual([]);
    expect(registry.list()).toEqual([]);
    expect(changes()).toBeGreaterThan(before);
  });

  it('a server that dies mid-session is failed, and its tools leave', async () => {
    const { manager, registry } = await rig();
    await manager.apply([stdio('fake')]);

    await call(registry, 'mcp__fake__crash');
    await until(() => manager.status()[0]?.state === 'failed');

    expect(registry.list()).toEqual([]);
    expect(manager.status()[0]?.error).toBeTruthy();
    // Applying the config again is the retry.
    await manager.apply([stdio('fake')]);
    expect(manager.status()[0]?.state).toBe('connected');
  });

  it.runIf(process.platform === 'win32')(
    'nothing it started outlives a stop — even behind a .cmd wrapper, as npx is on Windows',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'bp-mcp-'));
      const wrapper = join(dir, 'fake-server.cmd');
      await writeFile(wrapper, `@"${process.execPath}" "${FAKE}" %*\r\n`, 'utf8');
      const { manager, registry } = await rig();
      await manager.apply([
        // A server that ignores its stdin closing: only killing the tree ends it.
        { id: 'wrapped', transport: 'stdio', command: wrapper, env: { FAKE_MCP_IGNORE_EOF: '1' }, disabled: false },
      ]);
      const pid = Number((await call(registry, 'mcp__wrapped__pid')).content);
      expect(alive(pid)).toBe(true);

      await manager.stopAll();

      await until(() => !alive(pid), 3_000);
    },
  );

  it('a call ends when the turn is stopped', async () => {
    const { manager, registry } = await rig();
    await manager.apply([stdio('fake')]);
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 50);

    const result = await call(registry, 'mcp__fake__slow', { ms: 10_000 }, controller.signal);

    expect(result.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('a result too long for the context is cut, and says so', async () => {
    const { manager, registry } = await rig();
    await manager.apply([stdio('fake')]);
    const result = await call(registry, 'mcp__fake__echo', { text: 'x'.repeat(MAX_TOOL_OUTPUT_CHARS + 5_000) });
    expect(result.content.length).toBeLessThan(MAX_TOOL_OUTPUT_CHARS + 200);
    expect(result.content).toContain('truncated');
  });
});

describe('McpClientManager — streamable HTTP', () => {
  it('connects over HTTP, with its headers', async () => {
    const server = await startFakeMcpHttpServer({ token: 't0k' });
    https.push(server);
    const { manager, registry } = await rig();

    await manager.apply([
      { id: 'web', transport: 'http', url: server.url, headers: { Authorization: 'Bearer t0k' }, disabled: false },
      { id: 'nokey', transport: 'http', url: server.url, disabled: false },
    ]);

    expect(manager.status().find((s) => s.id === 'web')?.state).toBe('connected');
    expect(manager.status().find((s) => s.id === 'nokey')?.state).toBe('failed');
    expect(await call(registry, 'mcp__web__echo', { text: 'over http' })).toEqual({ ok: true, content: 'over http' });
  });
});

describe('mcpToolName', () => {
  it('namespaces by server, and keeps to what a grammar and a model read well', () => {
    expect(mcpToolName('fs', 'read_file')).toBe('mcp__fs__read_file');
    expect(mcpToolName('fs', 'read.file v2')).toBe('mcp__fs__read_file_v2');
    expect(mcpToolName('fs', 'x'.repeat(100)).length).toBeLessThanOrEqual(64);
  });
});
