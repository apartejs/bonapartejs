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
