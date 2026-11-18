/**
 * The MCP servers of the app (task 10.5): `config/mcp-servers.json`, in the shape every MCP guide shows
 * (`{ "mcpServers": { "<name>": { command, args, env, cwd } | { url, headers } } }`), an entry's `"project"`
 * naming the one project it serves (else the whole app). Nothing starts when the app starts: the first turn
 * starts every server not switched off, in the background — their tools join at the next turn, told as a
 * delta — and « Démarrer » starts one. A project's server is seen by that project's conversations only.
 *
 * The file is read for each change and written atomically, one change at a time; one that does not read is
 * never written over (it may hold keys): the change is refused, said. The headers of an HTTP server (a token)
 * never reach the page.
 */

import { join } from 'node:path';
import { KeyedQueue, readJsonFile, writeJsonFile } from '../fs/json-file.js';
import { holdsSecret } from '../process/env.js';
import type { SpawnFn } from '../process/spawn.js';
import type { SecretStore } from '../providers/secrets.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolDef } from '../tools/types.js';
import { mcpServerFromForm, parseMcpConfig, type McpConfigError, type McpServerConfig } from './config.js';
import { McpClientManager, mcpToolName } from './manager.js';

export type McpScope = { kind: 'app' } | { kind: 'project'; projectId: string };

export interface McpServerView {
  id: string;
  scope: McpScope;
  transport: 'stdio' | 'http';
  /** The command line, or the address — never the headers. */
  target: string;
  /** `stopped`: not started in this run (its tools come when it starts); `off`: switched off in the file. */
  state: 'stopped' | 'off' | 'connecting' | 'connected' | 'failed';
  error?: string;
  /** Its tools, as the server says them: read-only (a hint, never a guarantee) or not. */
  tools: { name: string; readOnly: boolean }[];
}

export interface McpServiceOptions {
  dataDir: string;
  registry: ToolRegistry;
  /** The environment a stdio server starts from: the app's minus its secrets. */
  env: () => Record<string, string>;
  log: (line: string) => void;
  clientVersion?: string;
  /** Tests only: what launches a stdio server. */
  spawn?: SpawnFn;
  /** The system's vault: a server's headers and the secrets of its environment live there, never in the file. */
  secrets?: SecretStore;
}

/** What stands in the file for a value kept in the system's vault. */
export const IN_THE_VAULT = '(kept in the system vault)';
const vaultName = (id: string): string => `mcp-${id}`;
type VaultedKeys = { headers?: Record<string, string>; env?: Record<string, string> };

export class McpFileUnreadableError extends Error {
  constructor(file: string, cause: unknown) {
    super(`The MCP configuration ${file} cannot be read (${cause instanceof Error ? cause.message : String(cause)}): it is left as it is.`);
    this.name = 'McpFileUnreadableError';
  }
}

interface Read {
  /** The file as written: kept as it is for what this change does not touch. */
  raw: Record<string, Record<string, unknown>>;
  servers: McpServerConfig[];
  errors: McpConfigError[];
  /** The project each server serves; absent: the whole app. */
  projects: Map<string, string>;
}

export class McpService {
  private readonly manager: McpClientManager;
  private readonly file: string;
  private readonly queue = new KeyedQueue();
  /** The servers asked to run in this run: the first turn asks for all, « Démarrer » for one. */
  private readonly wanted = new Set<string>();
  private allAsked = false;
  /** The project of each server, as last read: what `visibleTo` decides on. */
  private projects = new Map<string, string>();

  constructor(private readonly options: McpServiceOptions) {
    this.file = join(options.dataDir, 'config', 'mcp-servers.json');
    this.manager = new McpClientManager({
      registry: options.registry,
      env: options.env,
      ...(options.clientVersion ? { clientVersion: options.clientVersion } : {}),
      ...(options.spawn ? { spawn: options.spawn } : {}),
    });
  }

  /** The first turn: every server not switched off starts, in the background. */
  startAll(): void {
    if (this.allAsked) return;
    this.allAsked = true;
    void this.queue
      .run('apply', async () => {
        const read = await this.read();
        for (const server of read.servers) if (!server.disabled) this.wanted.add(server.id);
        await this.applyFrom(read);
      })
      .catch((error: unknown) => this.options.log(`[bonaparte] the MCP servers did not start: ${String(error)}`));
  }

  /**
   * « Démarrer », « Reconnecter », « Redémarrer »: a server stopped or failed starts; one connected goes down,
   * then starts again — a new process, its tools read again (review of phase 10).
   */
  async start(id: string): Promise<void> {
    await this.queue.run('apply', async () => {
      const read = await this.read();
      if (this.manager.status().find((status) => status.id === id)?.state === 'connected') {
        this.wanted.delete(id);
        await this.applyFrom(read);
      }
      this.wanted.add(id);
      await this.applyFrom(read);
    });
  }

  async stop(id: string): Promise<void> {
    await this.queue.run('apply', async () => {
      this.wanted.delete(id);
      await this.applyFrom(await this.read());
    });
  }

  async remove(id: string): Promise<void> {
    await this.change((raw) => {
      delete raw[id];
    });
    await this.options.secrets?.delete(vaultName(id));
    await this.stop(id);
  }

  /** « Coller une configuration »: its servers join the file by name; what does not read is said. */
  async paste(text: string): Promise<{ added: string[]; errors: McpConfigError[] }> {
    let pasted: unknown;
    try {
      pasted = JSON.parse(text);
    } catch {
      return { added: [], errors: [{ id: '', code: 'object', message: 'The text is not JSON.' }] };
    }
    // A bare map of servers is taken as the `mcpServers` of a file.
    const wrapped = isRecord(pasted) && isRecord(pasted['mcpServers']) ? pasted : { mcpServers: pasted };
    const { servers, errors } = parseMcpConfig(wrapped);
    const entries = (wrapped as { mcpServers: Record<string, Record<string, unknown>> }).mcpServers;
    const added = servers.map((server) => server.id);
    await this.change((raw) => {
      for (const id of added) raw[id] = entries[id]!;
    });
    return { added, errors };
  }

  /** « Ajouter un serveur »: a name, and an address or a command line; for the app or one project. */
  async add(input: { name: string; target: string; projectId?: string }): Promise<{ ok: true } | { ok: false; error: 'name' | 'target' }> {
    const made = mcpServerFromForm(input.name, input.target);
    if ('error' in made) return { ok: false, error: made.error };
    const { id: _id, transport: _transport, disabled: _disabled, ...entry } = made;
    await this.change((raw) => {
      raw[made.id] = { ...entry, ...(input.projectId ? { project: input.projectId } : {}) };
    });
    return { ok: true };
  }

  async overview(): Promise<McpServerView[]> {
    const read = await this.read().catch(() => null);
    if (!read) return [];
    const running = new Map(this.manager.status().map((status) => [status.id, status]));
    return read.servers.map((server): McpServerView => {
      const status = running.get(server.id);
      const projectId = read.projects.get(server.id);
      const tools = (status?.tools ?? []).map((name) => ({
        name,
        readOnly: this.options.registry.get(mcpToolName(server.id, name))?.def.effect === 'network',
      }));
      const state: McpServerView['state'] = server.disabled ? 'off' : !status ? 'stopped' : status.state === 'off' ? 'off' : status.state;
      return {
        id: server.id,
        scope: projectId ? { kind: 'project', projectId } : { kind: 'app' },
        transport: server.transport,
        target: server.transport === 'stdio' ? [server.command, ...(server.args ?? [])].join(' ') : server.url,
        state,
        ...(status?.error ? { error: status.error } : {}),
        tools,
      };
    });
  }

  /** What a conversation sees: an MCP tool of a project's server only in that project. */
  visibleTo(projectId: string | undefined): (def: ToolDef) => boolean {
    return (def) => {
      if (def.source !== 'mcp') return true;
      const server = [...this.projects.keys()].find((id) => def.name.startsWith(`mcp__${id}__`));
      const owner = server ? this.projects.get(server) : undefined;
      return owner === undefined || owner === projectId;
    };
  }

  async stopAll(): Promise<void> {
    this.wanted.clear();
    await this.manager.stopAll();
  }

  private async applyFrom(read: Read): Promise<void> {
    this.projects = read.projects;
    await this.manager.apply(read.servers.filter((server) => this.wanted.has(server.id) && !server.disabled));
  }

  private async read(): Promise<Read> {
    let found: unknown;
    try {
      found = await readJsonFile(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') found = { mcpServers: {} };
      else throw new McpFileUnreadableError(this.file, error);
    }
    const raw = isRecord(found) && isRecord(found['mcpServers']) ? (found['mcpServers'] as Record<string, Record<string, unknown>>) : {};
    const projects = new Map<string, string>();
    const bare: Record<string, Record<string, unknown>> = {};
    for (const [id, entry] of Object.entries(raw)) {
      if (!isRecord(entry)) continue;
      const { project, ...rest } = entry;
      if (typeof project === 'string' && project) projects.set(id, project);
      bare[id] = rest;
    }
    const parsed = parseMcpConfig({ mcpServers: bare });
    const servers = await Promise.all(parsed.servers.map((server) => this.unvaulted(server)));
    if (this.projects.size === 0) this.projects = projects;
    return { raw, servers, errors: parsed.errors, projects };
  }

  /** One change to the file: read, changed, written whole — never over a file that does not read. */
  private change(apply: (raw: Record<string, Record<string, unknown>>) => void): Promise<void> {
    return this.queue.run('file', async () => {
      const { raw } = await this.read();
      const next = { ...raw };
      apply(next);
      for (const [id, entry] of Object.entries(next)) next[id] = await this.vaulted(id, entry);
      await writeJsonFile(this.file, { mcpServers: next });
    });
  }

  /**
   * A server's keys leave the file for the vault (security rule 10, review of phase 10): every header of an HTTP
   * server, and every variable of a stdio server's environment whose name or value says it is a secret. Without
   * a vault, the server is refused rather than written in clear.
   */
  private async vaulted(id: string, entry: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Splits a map of values: those `secret` names go to the vault, a stand-in left in their place.
    const split = (from: unknown, secret: (name: string, value: string) => boolean): { left?: Record<string, unknown>; taken?: Record<string, string> } => {
      if (!isRecord(from)) return {};
      const left: Record<string, unknown> = { ...from };
      const taken: Record<string, string> = {};
      for (const [name, value] of Object.entries(from)) {
        if (typeof value !== 'string' || value === IN_THE_VAULT || !secret(name, value)) continue;
        taken[name] = value;
        left[name] = IN_THE_VAULT;
      }
      return Object.keys(taken).length > 0 ? { left, taken } : {};
    };
    const headers = split(entry['headers'], () => true);
    const env = split(entry['env'], holdsSecret);
    const found: VaultedKeys = { ...(headers.taken ? { headers: headers.taken } : {}), ...(env.taken ? { env: env.taken } : {}) };
    if (!found.headers && !found.env) return entry;
    const vault = this.options.secrets;
    if (!vault) throw new Error(`No vault on this machine: the keys of the MCP server « ${id} » cannot be kept, and are never written in clear.`);
    const before = JSON.parse((await vault.get(vaultName(id))) ?? '{}') as VaultedKeys;
    await vault.set(
      vaultName(id),
      JSON.stringify({ headers: { ...before.headers, ...found.headers }, env: { ...before.env, ...found.env } }),
    );
    return { ...entry, ...(headers.left ? { headers: headers.left } : {}), ...(env.left ? { env: env.left } : {}) };
  }

  /** A server as it starts: its keys back from the vault. */
  private async unvaulted(server: McpServerConfig): Promise<McpServerConfig> {
    const values = server.transport === 'http' ? server.headers : server.env;
    if (!values || !Object.values(values).includes(IN_THE_VAULT)) return server;
    const kept = JSON.parse((await this.options.secrets?.get(vaultName(server.id)).catch(() => undefined)) ?? '{}') as VaultedKeys;
    const from = server.transport === 'http' ? kept.headers : kept.env;
    const filled = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value === IN_THE_VAULT ? (from?.[name] ?? '') : value]));
    return server.transport === 'http' ? { ...server, headers: filled } : { ...server, env: filled };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
