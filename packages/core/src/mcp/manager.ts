/**
 * The MCP client (task 10.5, ported from v0): one client per configured server, over stdio or
 * streamable HTTP, on the official SDK. A stdio server is launched as every child process is — hidden, an
 * argument array, never a shell (our own transport) — with the app's environment minus its secrets, and its
 * whole tree goes down when it stops. What a server offers lands in the
 * single tool registry — named `mcp__<server>__<tool>`, sourced `mcp` — so
 * it reaches the grammar and the prompt like any other tool, and the
 * inventory change is appended as a delta, never re-rendered.
 *
 * Effects (P4.3, Q-29): a server's annotations are hints from another
 * program. A tool it marks read-only still reaches outside bonaparte, so
 * it is `network`; anything else runs something, so it is `execute`. The
 * permission modes and "always allow" treat them as they treat ours.
 *
 * A server that fails to start, or dies, is reported with the last words
 * it wrote on stderr; its tools leave the registry. Applying the config
 * again is the retry.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ToolEffect } from '@aparte/bonaparte-shared';
import type { SpawnFn } from '../process/spawn.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolDef, ToolOutput } from '../tools/types.js';
import { resolveCommand } from '../process/command.js';
import type { McpServerConfig } from './config.js';
import { HiddenStdioTransport } from './stdio-transport.js';

export type McpServerState = 'off' | 'connecting' | 'connected' | 'failed';

export interface McpServerStatus {
  id: string;
  transport: 'stdio' | 'http';
  /** The command line, or the URL — never the headers (they hold keys). */
  target: string;
  state: McpServerState;
  /** The server's own tool names. */
  tools: string[];
  error?: string;
}

export interface McpClientManagerOptions {
  registry: ToolRegistry;
  /** The tool inventory changed (a server came, went, or changed its tools). */
  onChange?: () => void;
  /** Sent to servers as the client's version. */
  clientVersion?: string;
  /** Default 60 s: a first `npx` of a server downloads it. */
  connectTimeoutMs?: number;
  /** Default 120 s, restarted by the server's progress notifications. */
  callTimeoutMs?: number;
  /** The environment a stdio server starts from (the app's minus its secrets); its config's own is laid over it. */
  env?: () => Record<string, string>;
  /** Tests only: what launches a stdio server. */
  spawn?: SpawnFn;
}

/** Tool names in the grammar and the prompt: letters, digits, `_` and `-`, 64 at most. */
export function mcpToolName(serverId: string, toolName: string): string {
  return `mcp__${serverId}__${toolName.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64);
}

/** A server's description, bounded: every tool's description is in every prompt. */
const MAX_DESCRIPTION_CHARS = 1_024;
/** A server's tool list, bounded: pages, and tools in all. */
const MAX_TOOL_PAGES = 50;
const MAX_TOOLS = 1_000;
/** The last words a server wrote on stderr, kept to explain a failure. */
const STDERR_TAIL_CHARS = 2_000;

interface Connection {
  config: McpServerConfig;
  /** The config as applied — a change reconnects. */
  key: string;
  state: McpServerState;
  error?: string;
  client?: Client;
  /**
   * The transport, kept to read its process id LIVE: set from the spawn
   * (a stop while connecting still finds it), gone once the process exited
   * (a pid Windows may have given to another program is never killed).
   */
  transport?: HiddenStdioTransport | StreamableHTTPClientTransport;
  /** Registered names, server name → registry name. */
  registered: Map<string, string>;
  stderr: string;
  /** Set when we close it ourselves: not a failure. */
  closing: boolean;
}

export class McpClientManager {
  private readonly connections = new Map<string, Connection>();

  constructor(private readonly options: McpClientManagerOptions) {}

  /**
   * Reconciles with a config: servers gone, switched off or changed are
   * stopped; new ones, changed ones and failed ones are (re)started — all
   * at once, one slow server never holding the others.
   */
  async apply(configs: McpServerConfig[]): Promise<void> {
    const wanted = new Map(configs.map((config) => [config.id, config]));
    const stops: Promise<void>[] = [];
    for (const [id, connection] of this.connections) {
      const next = wanted.get(id);
      if (!next || JSON.stringify(next) !== connection.key || next.disabled) {
        stops.push(this.stop(connection));
        this.connections.delete(id);
      }
    }
    await Promise.all(stops);

    const starts: Promise<void>[] = [];
    for (const config of configs) {
      const current = this.connections.get(config.id);
      if (current && current.state !== 'failed') continue;
      const connection: Connection = {
        config,
        key: JSON.stringify(config),
        state: config.disabled ? 'off' : 'connecting',
        registered: new Map(),
        stderr: '',
        closing: false,
      };
      this.connections.set(config.id, connection);
      if (!config.disabled) starts.push(this.start(connection));
    }
    await Promise.all(starts);
  }

  status(): McpServerStatus[] {
    return [...this.connections.values()].map((connection) => ({
      id: connection.config.id,
      transport: connection.config.transport,
      target:
        connection.config.transport === 'stdio'
          ? [connection.config.command, ...(connection.config.args ?? [])].join(' ')
          : connection.config.url,
      state: connection.state,
      tools: [...connection.registered.keys()],
      ...(connection.error ? { error: connection.error } : {}),
    }));
  }

  async stopAll(): Promise<void> {
    const all = [...this.connections.values()];
    this.connections.clear();
    await Promise.all(all.map((connection) => this.stop(connection)));
  }

  private async start(connection: Connection): Promise<void> {
    const { config } = connection;
    const client = new Client({ name: 'bonaparte', version: this.options.clientVersion ?? '0.0.0' }, { capabilities: {} });
    connection.client = client;
    try {
      let transport: HiddenStdioTransport | StreamableHTTPClientTransport;
      if (config.transport === 'stdio') {
        const env = { ...(this.options.env?.() ?? {}), ...(config.env ?? {}) };
        // On Windows `npx` is a `.cmd`: run by node and its script, never by a shell.
        const resolved = resolveCommand(config.command, config.args ?? [], { env });
        const stdio = new HiddenStdioTransport({
          command: resolved.command,
          args: resolved.args,
          env,
          ...(config.cwd ? { cwd: config.cwd } : {}),
          ...(this.options.spawn ? { spawn: this.options.spawn } : {}),
        });
        stdio.onStderr((text) => {
          connection.stderr = (connection.stderr + text).slice(-STDERR_TAIL_CHARS);
        });
        transport = stdio;
      } else {
        transport = new StreamableHTTPClientTransport(new URL(config.url), {
          ...(config.headers ? { requestInit: { headers: config.headers } } : {}),
        });
      }
      connection.transport = transport;
      client.onclose = () => {
        if (connection.closing || this.connections.get(config.id) !== connection) return;
        this.fail(connection, 'The server stopped.');
      };
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        if (connection.state === 'connected') await this.refreshTools(connection).catch(() => undefined);
      });
      await client.connect(transport, { timeout: this.options.connectTimeoutMs ?? 60_000 });
      await this.refreshTools(connection);
      connection.state = 'connected';
    } catch (error) {
      this.fail(connection, describe(error));
      connection.closing = true;
      await client.close().catch(() => undefined);
      await connection.transport?.close().catch(() => undefined);
    }
  }

  private fail(connection: Connection, reason: string): void {
    connection.state = 'failed';
    const said = connection.stderr.trim().split(/\r?\n/).slice(-3).join('\n');
    connection.error = said ? `${reason}\n${said}` : reason;
    this.unregisterAll(connection);
  }

  private async stop(connection: Connection): Promise<void> {
    connection.closing = true;
    this.unregisterAll(connection);
    await connection.client?.close().catch(() => undefined);
    // The client's close ends our transport, the whole tree with it; said again for a client never connected.
    await connection.transport?.close().catch(() => undefined);
  }

  /** Lists the server's tools (every page) and brings the registry to them. */
  private async refreshTools(connection: Connection): Promise<void> {
    const client = connection.client;
    if (!client) return;
    const tools: Awaited<ReturnType<Client['listTools']>>['tools'] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
      // A list that never ends (a cursor said twice, pages without end)
      // would hold every other server: refused, and said.
      if (cursor !== undefined && (seen.has(cursor) || seen.size >= MAX_TOOL_PAGES || tools.length > MAX_TOOLS)) {
        throw new Error('The server lists its tools without end.');
      }
      if (cursor !== undefined) seen.add(cursor);
    } while (cursor);

    const { registry } = this.options;
    let changed = false;
    const offered = new Set(tools.map((tool) => tool.name));
    for (const [serverName, registryName] of connection.registered) {
      if (offered.has(serverName)) continue;
      registry.unregister(registryName);
      connection.registered.delete(serverName);
      changed = true;
    }
    for (const tool of tools) {
      const name = mcpToolName(connection.config.id, tool.name);
      const description = (tool.description ?? tool.title ?? tool.name).trim();
      const def: ToolDef = {
        name,
        description: description.length > MAX_DESCRIPTION_CHARS ? `${description.slice(0, MAX_DESCRIPTION_CHARS)}…` : description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
        effect: mcpEffect(tool.annotations),
        source: 'mcp',
        where: 'core',
      };
      const previous = connection.registered.get(tool.name);
      if (previous) {
        // The same tool, said again (a list_changed that changes nothing):
        // no change — nothing to tell anyone.
        if (JSON.stringify(registry.get(previous)?.def) === JSON.stringify(def)) continue;
        registry.unregister(previous);
      } else if (registry.get(name)) continue; // two server names folding to one: the first stays
      registry.register(def, (call, ctx) => this.call(connection, tool.name, (call.input ?? {}) as Record<string, unknown>, ctx.signal));
      connection.registered.set(tool.name, name);
      changed = true;
    }
    if (changed) this.options.onChange?.();
  }

  private async call(
    connection: Connection,
    toolName: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<ToolOutput> {
    const client = connection.client;
    if (!client || connection.state !== 'connected') {
      return { failed: true, content: `The MCP server "${connection.config.id}" is not connected.` };
    }
    try {
      const result = await client.callTool({ name: toolName, arguments: args }, undefined, {
        signal,
        timeout: this.options.callTimeoutMs ?? 120_000,
        resetTimeoutOnProgress: true,
      });
      // The registry cuts what the model reads to its context; a result past all measure is cut here first.
      const content = clamp(renderContent(result));
      return result.isError === true ? { failed: true, content } : { content };
    } catch (error) {
      if (signal.aborted) return { failed: true, content: 'Cancelled.' };
      return { failed: true, content: `The MCP server "${connection.config.id}" failed: ${describe(error)}` };
    }
  }

  private unregisterAll(connection: Connection): void {
    if (connection.registered.size === 0) return;
    for (const name of connection.registered.values()) this.options.registry.unregister(name);
    connection.registered.clear();
    this.options.onChange?.();
  }
}

function mcpEffect(annotations: { readOnlyHint?: boolean } | undefined): ToolEffect {
  return annotations?.readOnlyHint === true ? 'network' : 'execute';
}

/** A tool result as text for the model: text as is, anything else named rather than dropped. */
function renderContent(result: Record<string, unknown>): string {
  const content = result['content'];
  if (!Array.isArray(content)) {
    // A server of the first protocol version answers `toolResult`.
    return JSON.stringify(result['structuredContent'] ?? result['toolResult'] ?? '');
  }
  const parts = content.map((part: Record<string, unknown>) => {
    switch (part['type']) {
      case 'text':
        return String(part['text'] ?? '');
      case 'image':
      case 'audio':
        return `[${String(part['mimeType'] ?? 'binary')} ${String(part['type'])} omitted]`;
      case 'resource': {
        const resource = (part['resource'] ?? {}) as Record<string, unknown>;
        return typeof resource['text'] === 'string' ? resource['text'] : `[resource ${String(resource['uri'] ?? '')}]`;
      }
      case 'resource_link':
        return `[link ${String(part['uri'] ?? '')}]`;
      default:
        return `[${String(part['type'])} content omitted]`;
    }
  });
  if (parts.length === 0 && result['structuredContent'] !== undefined) return JSON.stringify(result['structuredContent']);
  return parts.join('\n');
}

/** Far past any context: the registry cuts to the context, this only keeps a runaway server's answer in bounds. */
const MAX_RESULT_CHARS = 1_000_000;

function clamp(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n… [truncated: ${text.length} characters total]`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
