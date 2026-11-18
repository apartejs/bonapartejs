/**
 * The MCP servers of the app (task 10.5): kept in `config/mcp-servers.json` (the shape every MCP guide shows),
 * for the whole app or for one project. Nothing starts before a turn asks for them or « Démarrer »; their tools
 * then join the one registry, split as the page shows them; a project's server is seen by that project's
 * conversations only; a file that does not read is never written over — it may hold keys.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withoutSecrets } from '../process/env.js';
import type { SpawnFn } from '../process/spawn.js';
import { spawnHidden } from '../process/spawn.js';
import type { SecretStore } from '../providers/secrets.js';
import { ToolRegistry } from '../tools/registry.js';
import { McpService } from './service.js';

const FAKE = fileURLToPath(new URL('../testing/fake-mcp-server.mjs', import.meta.url));
const services: McpService[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stopAll()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function rig(servers: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bp-mcp-service-'));
  dirs.push(dir);
  await mkdir(join(dir, 'config'), { recursive: true });
  const file = join(dir, 'config', 'mcp-servers.json');
  if (Object.keys(servers).length > 0) await writeFile(file, JSON.stringify({ mcpServers: servers }));
  const registry = new ToolRegistry();
  const service = new McpService({ dataDir: dir, registry, env: () => withoutSecrets(process.env), log: () => undefined });
  services.push(service);
  return { service, registry, file };
}

const fake = { command: process.execPath, args: [FAKE] };
const mcpTools = (registry: ToolRegistry) => registry.list().filter((def) => def.source === 'mcp').map((def) => def.name);

describe('the MCP servers of the app (task 10.5)', () => {
  it('nothing starts before it is asked: the servers are listed, stopped, and offer no tool yet', async () => {
    const { service, registry } = await rig({ fake });
    expect(await service.overview()).toMatchObject([{ id: 'fake', scope: { kind: 'app' }, transport: 'stdio', state: 'stopped', tools: [] }]);
    expect(mcpTools(registry)).toEqual([]);
  });

  it('started, a server’s tools join the registry, split as the server says: read-only, or not', async () => {
    const { service, registry } = await rig({ fake });
    await service.start('fake');
    const [view] = await service.overview();
    expect(view).toMatchObject({ id: 'fake', state: 'connected', target: `${process.execPath} ${FAKE}` });
    expect(view!.tools).toEqual(expect.arrayContaining([{ name: 'echo', readOnly: true }, { name: 'write_note', readOnly: false }]));
    expect(mcpTools(registry)).toEqual(expect.arrayContaining(['mcp__fake__echo', 'mcp__fake__write_note']));
  });

  it('« Redémarrer » — start on a connected server — starts it again: a new process (review of phase 10)', async () => {
    const pidFile = join(tmpdir(), `bp-mcp-pid-${process.pid}-${Date.now()}`);
    const { service } = await rig({ fake: { ...fake, env: { FAKE_MCP_PID_FILE: pidFile } } });
    await service.start('fake');
    const first = await readFile(pidFile, 'utf8');
    await service.start('fake');
    expect((await service.overview())[0]).toMatchObject({ state: 'connected' });
    expect(await readFile(pidFile, 'utf8')).not.toBe(first);
    await rm(pidFile, { force: true });
  });

  it('the first turn starts every server not switched off, without waiting for them', async () => {
    const { service } = await rig({ fake, off: { ...fake, disabled: true } });
    service.startAll();
    await vi.waitFor(async () => expect((await service.overview()).find((one) => one.id === 'fake')?.state).toBe('connected'), { timeout: 10_000 });
    expect((await service.overview()).find((one) => one.id === 'off')?.state).toBe('off');
  });

  it('a project’s server is seen by that project’s conversations only', async () => {
    const { service, registry } = await rig({ fake: { ...fake, project: 'p1' } });
    await service.start('fake');
    expect((await service.overview())[0]).toMatchObject({ scope: { kind: 'project', projectId: 'p1' } });
    const echo = registry.get('mcp__fake__echo')!.def;
    expect(service.visibleTo('p1')(echo)).toBe(true);
    expect(service.visibleTo('p2')(echo)).toBe(false);
    expect(service.visibleTo(undefined)(echo)).toBe(false);
    // Any other tool passes.
    expect(service.visibleTo(undefined)({ ...echo, name: 'read_file', source: 'builtin' })).toBe(true);
  });

  it('stopped, its tools leave; removed, it leaves the file — the others kept', async () => {
    const { service, registry, file } = await rig({ fake, other: fake });
    await service.start('fake');
    await service.stop('fake');
    expect(mcpTools(registry)).toEqual([]);
    expect((await service.overview()).find((one) => one.id === 'fake')?.state).toBe('stopped');
    await service.remove('fake');
    expect(Object.keys((JSON.parse(await readFile(file, 'utf8')) as { mcpServers: object }).mcpServers)).toEqual(['other']);
  });

  it('a configuration pasted: its servers join the file, by name; an entry that does not read is said', async () => {
    const { service, file } = await rig({ kept: fake });
    const result = await service.paste(JSON.stringify({ mcpServers: { pasted: fake, broken: { command: '' } } }));
    expect(result.added).toEqual(['pasted']);
    expect(result.errors).toMatchObject([{ id: 'broken' }]);
    const saved = JSON.parse(await readFile(file, 'utf8')) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(saved.mcpServers).sort()).toEqual(['kept', 'pasted']);
  });

  it('a server added from a name and an address or a command line, for the app or a project', async () => {
    const { service } = await rig();
    expect(await service.add({ name: 'web', target: 'https://mcp.example.com/mcp', projectId: 'p1' })).toEqual({ ok: true });
    expect(await service.add({ name: 'bad__name', target: 'x' })).toEqual({ ok: false, error: 'name' });
    expect(await service.overview()).toMatchObject([{ id: 'web', transport: 'http', target: 'https://mcp.example.com/mcp', scope: { kind: 'project', projectId: 'p1' } }]);
  });

  it('a file that does not read is never written over: a paste is refused, the file kept as it was', async () => {
    const { service, file } = await rig();
    await writeFile(file, '{ "mcpServers": { "secret": { "url": "https://x", "headers": { "Authorization": "Bearer k" } } ');
    await expect(service.paste(JSON.stringify({ mcpServers: { pasted: fake } }))).rejects.toThrow(/cannot be read/);
    expect(await readFile(file, 'utf8')).toContain('Bearer k');
  });

  it('the headers of an HTTP server never reach the page: its address only', async () => {
    const { service } = await rig({ secret: { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer k' } } });
    const views = await service.overview();
    expect(JSON.stringify(views)).not.toContain('Bearer');
    expect(views[0]).toMatchObject({ target: 'https://mcp.example.com/mcp' });
  });
});

describe('the keys of an MCP server (review of phase 10, security rule 10)', () => {
  function vault(): SecretStore & { kept: Map<string, string> } {
    const kept = new Map<string, string>();
    return {
      kept,
      get: async (name) => kept.get(name),
      set: async (name, value) => void kept.set(name, value),
      delete: async (name) => void kept.delete(name),
      has: async (name) => kept.has(name),
    };
  }

  async function keyed(secrets: SecretStore | undefined) {
    const dir = await mkdtemp(join(tmpdir(), 'bp-mcp-keys-'));
    dirs.push(dir);
    await mkdir(join(dir, 'config'), { recursive: true });
    const file = join(dir, 'config', 'mcp-servers.json');
    const launched: Record<string, string | undefined>[] = [];
    const spawn: SpawnFn = (command, args, options) => {
      launched.push({ ...(options.env as Record<string, string | undefined>) });
      return spawnHidden(command, args, options as never);
    };
    const service = new McpService({ dataDir: dir, registry: new ToolRegistry(), env: () => withoutSecrets(process.env), log: () => undefined, spawn, ...(secrets ? { secrets } : {}) });
    services.push(service);
    return { service, file, launched };
  }

  const PASTED = JSON.stringify({
    mcpServers: {
      gh: { ...fake, env: { GITHUB_TOKEN: 'ghp_secret1', LOG_LEVEL: 'debug' } },
      web: { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ghp_secret2' } },
    },
  });

  it('a pasted server’s token and headers go to the vault, never into the file; the server still gets them', async () => {
    const secrets = vault();
    const { service, file, launched } = await keyed(secrets);
    expect((await service.paste(PASTED)).added).toEqual(['gh', 'web']);
    const written = await readFile(file, 'utf8');
    expect(written).not.toContain('ghp_secret');
    expect(written).toContain('LOG_LEVEL');
    expect([...secrets.kept.values()].join(' ')).toContain('ghp_secret1');
    expect([...secrets.kept.values()].join(' ')).toContain('ghp_secret2');
    await service.start('gh');
    expect(launched.at(-1)).toMatchObject({ GITHUB_TOKEN: 'ghp_secret1', LOG_LEVEL: 'debug' });
  });

  it('without a vault, a server with a token is refused rather than written in clear', async () => {
    const { service, file } = await keyed(undefined);
    await expect(service.paste(PASTED)).rejects.toThrow(/vault/);
    await expect(readFile(file, 'utf8')).rejects.toThrow();
  });

  it('removed, a server’s keys leave the vault', async () => {
    const secrets = vault();
    const { service } = await keyed(secrets);
    await service.paste(PASTED);
    await service.remove('web');
    expect([...secrets.kept.values()].join(' ')).not.toContain('ghp_secret2');
    expect([...secrets.kept.values()].join(' ')).toContain('ghp_secret1');
  });
});
