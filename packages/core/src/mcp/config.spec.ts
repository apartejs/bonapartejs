/**
 * `mcp-servers.json` (P4.2): the shape every MCP guide already shows —
 * `{ "mcpServers": { "<name>": { "command", "args", "env" } | { "url", "headers" } } }` —
 * so a server's documented snippet can be pasted as is. Nothing is imposed
 * (D-69): each server can be switched off, and a broken entry is reported
 * by name, never a reason to lose the others.
 */

import { describe, expect, it } from 'vitest';
import { mcpServerFromForm, parseMcpConfig, serializeMcpConfig, splitCommandLine, type McpServerConfig } from './config.js';

describe('parseMcpConfig', () => {
  it('reads command servers and URL servers, in the shape the MCP guides show', () => {
    const { servers, errors } = parseMcpConfig({
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\code'],
          env: { LOG: '1' },
        },
        docs: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer x' } },
        typed: { type: 'http', url: 'http://localhost:9000/mcp' },
        off: { command: 'node', args: ['server.js'], disabled: true, cwd: 'C:\\srv' },
      },
    });

    expect(errors).toEqual([]);
    expect(servers).toEqual<McpServerConfig[]>([
      {
        id: 'filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\code'],
        env: { LOG: '1' },
        disabled: false,
      },
      {
        id: 'docs',
        transport: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer x' },
        disabled: false,
      },
      { id: 'typed', transport: 'http', url: 'http://localhost:9000/mcp', disabled: false },
      { id: 'off', transport: 'stdio', command: 'node', args: ['server.js'], cwd: 'C:\\srv', disabled: true },
    ]);
  });

  it('reports a broken entry by name and keeps the others', () => {
    const { servers, errors } = parseMcpConfig({
      mcpServers: {
        good: { command: 'node' },
        empty: {},
        both: { command: 'node', url: 'http://x' },
        'bad name!': { command: 'node' },
        ftp: { url: 'ftp://example.com' },
        args: { command: 'node', args: 'not-an-array' },
      },
    });
    expect(servers.map((server) => server.id)).toEqual(['good']);
    expect(errors.map((error) => [error.id, error.code])).toEqual([
      ['empty', 'command'],
      ['both', 'both'],
      ['bad name!', 'name'],
      ['ftp', 'url'],
      ['args', 'args'],
    ]);
    expect(errors.every((error) => error.message.length > 0)).toBe(true);
  });

  it('an absent or unusable file is no server, not an error', () => {
    expect(parseMcpConfig(undefined)).toEqual({ servers: [], errors: [] });
    expect(parseMcpConfig({})).toEqual({ servers: [], errors: [] });
    expect(parseMcpConfig('nonsense').servers).toEqual([]);
  });

  it('writes back what it reads', () => {
    const raw = {
      mcpServers: {
        filesystem: { command: 'npx', args: ['-y', 'server-filesystem'] },
        docs: { url: 'https://example.com/mcp', disabled: true },
      },
    };
    const { servers } = parseMcpConfig(raw);
    expect(parseMcpConfig(serializeMcpConfig(servers)).servers).toEqual(servers);
    expect(serializeMcpConfig(servers)).toEqual({
      mcpServers: {
        filesystem: { command: 'npx', args: ['-y', 'server-filesystem'] },
        docs: { url: 'https://example.com/mcp', disabled: true },
      },
    });
  });
});

describe('splitCommandLine', () => {
  it('splits on spaces, keeps quoted parts whole, and leaves Windows backslashes alone', () => {
    expect(splitCommandLine(String.raw`npx -y @modelcontextprotocol/server-filesystem C:\code`)).toEqual([
      'npx',
      '-y',
      '@modelcontextprotocol/server-filesystem',
      String.raw`C:\code`,
    ]);
    expect(splitCommandLine(String.raw`node "C:\My Tools\server.js" --name 'a b'`)).toEqual([
      'node',
      String.raw`C:\My Tools\server.js`,
      '--name',
      'a b',
    ]);
    expect(splitCommandLine('   ')).toEqual([]);
  });
});

describe('mcpServerFromForm', () => {
  it('a URL is an HTTP server, anything else a command line', () => {
    expect(mcpServerFromForm('docs', 'https://example.com/mcp')).toEqual({
      id: 'docs',
      transport: 'http',
      url: 'https://example.com/mcp',
      disabled: false,
    });
    expect(mcpServerFromForm('fs', String.raw`npx -y server-filesystem "C:\a b"`)).toEqual({
      id: 'fs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'server-filesystem', String.raw`C:\a b`],
      disabled: false,
    });
  });

  it('says what is wrong, in words', () => {
    expect(mcpServerFromForm('bad name', 'npx x')).toEqual({ error: 'name' });
    expect(mcpServerFromForm('ok', '   ')).toEqual({ error: 'target' });
  });

  it('refuses the names an object keeps for itself', () => {
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      expect(mcpServerFromForm(name, 'npx x')).toEqual({ error: 'name' });
    }
    const raw = JSON.parse('{"mcpServers": {"__proto__": {"command": "node"}, "constructor": {"command": "node"}}}');
    expect(parseMcpConfig(raw).servers).toEqual([]);
  });
});
