/**
 * `mcp-servers.json` (P4.2) — the shape every MCP guide shows, so a
 * server's documented snippet pastes as is:
 *
 *   { "mcpServers": { "<name>": { "command", "args", "env", "cwd" }
 *                   | { "url", "headers" } } }
 *
 * plus `disabled: true` to keep a server without starting it (D-69: nothing
 * is imposed). A broken entry is reported by name and the others still
 * load.
 */

export type McpServerConfig =
  | {
      id: string;
      transport: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
      disabled: boolean;
    }
  | {
      id: string;
      transport: 'http';
      url: string;
      headers?: Record<string, string>;
      disabled: boolean;
    };

/** What is wrong with an entry — a code the hub words in the user's language. */
export type McpConfigErrorCode = 'name' | 'object' | 'both' | 'url' | 'headers' | 'command' | 'args' | 'env' | 'cwd';

export interface McpConfigError {
  id: string;
  code: McpConfigErrorCode;
  /** The same, in English — for logs. */
  message: string;
}

const MESSAGES: Record<McpConfigErrorCode, string> = {
  name: 'a server name is letters, digits, "-" or "_", 32 at most',
  object: 'not an object',
  both: 'either "command" or "url", not both',
  url: '"url" must be an http(s) URL',
  headers: '"headers" must map names to strings',
  command: 'needs a "command" (a program to run) or a "url"',
  args: '"args" must be a list of strings',
  env: '"env" must map names to strings',
  cwd: '"cwd" must be a folder path',
};

/** Server names become part of tool names (`mcp__<name>__<tool>`): kept to what a grammar and a model read well. */
export const MCP_SERVER_ID = /^[A-Za-z0-9_-]{1,32}$/;

export function parseMcpConfig(raw: unknown): { servers: McpServerConfig[]; errors: McpConfigError[] } {
  const servers: McpServerConfig[] = [];
  const errors: McpConfigError[] = [];
  const entries = isRecord(raw) && isRecord(raw['mcpServers']) ? Object.entries(raw['mcpServers']) : [];
  for (const [id, entry] of entries) {
    const outcome = parseEntry(id, entry);
    if (typeof outcome === 'string') errors.push({ id, code: outcome, message: MESSAGES[outcome] });
    else servers.push(outcome);
  }
  return { servers, errors };
}

export function serializeMcpConfig(servers: McpServerConfig[]): { mcpServers: Record<string, Record<string, unknown>> } {
  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const server of servers) {
    const { id: _id, transport: _transport, disabled, ...rest } = server;
    mcpServers[server.id] = { ...rest, ...(disabled ? { disabled: true } : {}) };
  }
  return { mcpServers };
}

function parseEntry(id: string, entry: unknown): McpServerConfig | McpConfigErrorCode {
  if (!MCP_SERVER_ID.test(id)) return 'name';
  if (!isRecord(entry)) return 'object';
  const disabled = entry['disabled'] === true;
  const command = entry['command'];
  const url = entry['url'];
  if (command !== undefined && url !== undefined) return 'both';
  if (typeof url === 'string') {
    if (!/^https?:\/\//i.test(url)) return 'url';
    const headers = stringRecord(entry['headers']);
    if (headers === null) return 'headers';
    return { id, transport: 'http', url, ...(headers ? { headers } : {}), disabled };
  }
  if (typeof command !== 'string' || command.trim() === '') return 'command';
  const args = entry['args'];
  if (args !== undefined && !(Array.isArray(args) && args.every((arg) => typeof arg === 'string'))) {
    return 'args';
  }
  const env = stringRecord(entry['env']);
  if (env === null) return 'env';
  const cwd = entry['cwd'];
  if (cwd !== undefined && typeof cwd !== 'string') return 'cwd';
  return {
    id,
    transport: 'stdio',
    command,
    ...(Array.isArray(args) ? { args: args as string[] } : {}),
    ...(env ? { env } : {}),
    ...(typeof cwd === 'string' ? { cwd } : {}),
    disabled,
  };
}

/**
 * A command line as typed in the hub, into its words: spaces separate,
 * double or single quotes keep a part whole, backslashes stay as they are
 * (Windows paths).
 */
export function splitCommandLine(line: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) words.push(current);
  return words;
}

/**
 * A server from the hub's form: a name, and one field that is either a URL
 * (an HTTP server) or a command line. `error` names the field at fault.
 */
export function mcpServerFromForm(name: string, target: string): McpServerConfig | { error: 'name' | 'target' } {
  const id = name.trim();
  if (!MCP_SERVER_ID.test(id)) return { error: 'name' };
  const value = target.trim();
  if (/^https?:\/\//i.test(value)) return { id, transport: 'http', url: value, disabled: false };
  const [command, ...args] = splitCommandLine(value);
  if (!command) return { error: 'target' };
  return { id, transport: 'stdio', command, ...(args.length > 0 ? { args } : {}), disabled: false };
}

/** A map of strings; undefined when absent, null when malformed. */
function stringRecord(value: unknown): Record<string, string> | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') return null;
    out[key] = item;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
