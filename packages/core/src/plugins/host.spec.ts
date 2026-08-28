import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../tools/registry.js';
import { PluginHost } from './host.js';

let dirs: string[] = [];

async function makePluginDir(
  id: string,
  manifest: Record<string, unknown>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bp-plugins-'));
  dirs.push(root);
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'plugin.json'), JSON.stringify(manifest), 'utf8');
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

const manifest = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Plugin ${id}`,
  version: '0.1.0',
  ...extra,
});

describe('PluginHost — discovery', () => {
  it('reads a valid manifest WITHOUT executing the plugin', async () => {
    const root = await makePluginDir('terminal', manifest('terminal'));
    const host = new PluginHost({ registry: new ToolRegistry() });

    const found = await host.discover(root);

    expect(found.map((p) => p.id)).toEqual(['terminal']);
    expect(found[0]?.error).toBeUndefined();
  });

  it('reports an invalid manifest instead of loading it', async () => {
    // `id` in uppercase: rejected by the schema.
    const root = await makePluginDir('bad', { id: 'BAD', name: 'x', version: '1' });
    const host = new PluginHost({ registry: new ToolRegistry() });

    const found = await host.discover(root);

    expect(found).toHaveLength(1);
    expect(found[0]?.error).toBeTruthy();
    expect(found[0]?.active).toBe(false);
  });

  it('ignores a folder with no manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bp-plugins-'));
    dirs.push(root);
    await mkdir(join(root, 'not-a-plugin'), { recursive: true });
    const host = new PluginHost({ registry: new ToolRegistry() });

    expect(await host.discover(root)).toEqual([]);
  });

  it('refuses a second plugin claiming the same id', async () => {
    const root = await makePluginDir('dupe', manifest('dupe'));
    // A second folder whose manifest claims the same id.
    await mkdir(join(root, 'other'), { recursive: true });
    await writeFile(
      join(root, 'other', 'plugin.json'),
      JSON.stringify(manifest('dupe')),
      'utf8',
    );
    const host = new PluginHost({ registry: new ToolRegistry() });

    const found = await host.discover(root);
    const rejected = found.filter((p) => p.error);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.error).toMatch(/identifier/i);
  });
});

describe('PluginHost — reversible activation', () => {
  const withTool = (id: string) =>
    manifest(id, {
      contributes: {
        agentTools: [
          { name: 'demo_tool', description: 'a demo tool', effect: 'read' },
        ],
      },
    });

  it('only adds the tool to the inventory once the handler is wired up', async () => {
    const root = await makePluginDir('demo', withTool('demo'));
    const registry = new ToolRegistry();
    const host = new PluginHost({ registry });
    await host.discover(root);

    // The manifest declares the tool, but nothing executes it yet.
    expect(registry.list()).toHaveLength(0);

    await host.activate('demo', {
      activate: (ctx) => {
        ctx.registerToolHandler('demo_tool', async () => ({ ok: true, content: 'ok' }));
      },
    });

    expect(registry.list().map((t) => t.name)).toEqual(['demo_tool']);
  });

  it('undoes EVERYTHING on teardown, with no effort from the plugin', async () => {
    // This is the contract's invariant: reversibility lives in the primitive.
    const root = await makePluginDir('demo', withTool('demo'));
    const registry = new ToolRegistry();
    const host = new PluginHost({ registry });
    await host.discover(root);

    const cleanup = vi.fn();
    await host.activate('demo', {
      activate: (ctx) => {
        ctx.registerToolHandler('demo_tool', async () => ({ ok: true, content: 'ok' }));
        ctx.onDispose(cleanup);
      },
    });
    expect(registry.list()).toHaveLength(1);

    await host.deactivate('demo');

    expect(registry.list()).toHaveLength(0);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(host.status().find((p) => p.id === 'demo')?.active).toBe(false);
  });

  it('refuses a handler for a tool not declared in the manifest', async () => {
    // The manifest must remain readable without executing the plugin: a
    // tool that only appeared at activation time would make it a lie.
    const root = await makePluginDir('demo', withTool('demo'));
    const host = new PluginHost({ registry: new ToolRegistry() });
    await host.discover(root);

    await expect(
      host.activate('demo', {
        activate: (ctx) => {
          ctx.registerToolHandler('clandestine_tool', async () => ({
            ok: true,
            content: '',
          }));
        },
      }),
    ).rejects.toThrow(/not declared/i);
  });

  it('a plugin that blows up during activation leaves nothing behind', async () => {
    const root = await makePluginDir('demo', withTool('demo'));
    const registry = new ToolRegistry();
    const host = new PluginHost({ registry });
    await host.discover(root);

    await expect(
      host.activate('demo', {
        activate: (ctx) => {
          ctx.registerToolHandler('demo_tool', async () => ({ ok: true, content: '' }));
          throw new Error('boum');
        },
      }),
    ).rejects.toThrow('boum');

    // The inventory must not keep the tool of a half-activated plugin.
    expect(registry.list()).toHaveLength(0);
    const status = host.status().find((p) => p.id === 'demo');
    expect(status?.active).toBe(false);
    expect(status?.error).toContain('boum');
  });

  it('routes a command from the view to its Node half', async () => {
    // A plugin view cannot talk to its own Node process without this: it
    // would have to go through ad hoc channels, outside the contract.
    const root = await makePluginDir('demo', manifest('demo'));
    const host = new PluginHost({ registry: new ToolRegistry() });
    await host.discover(root);
    await host.activate('demo', {
      activate: (ctx) => {
        ctx.registerCommand('ping', async (payload) => ({ pong: payload }));
      },
    });

    expect(await host.invoke('demo', 'ping', 42)).toEqual({ pong: 42 });
  });

  it('a command disappears with its plugin', async () => {
    const root = await makePluginDir('demo', manifest('demo'));
    const host = new PluginHost({ registry: new ToolRegistry() });
    await host.discover(root);
    await host.activate('demo', {
      activate: (ctx) => ctx.registerCommand('ping', async () => 'ok'),
    });
    await host.deactivate('demo');

    await expect(host.invoke('demo', 'ping', null)).rejects.toThrow(/unknown/i);
  });

  it('exposes the views contributed by active plugins', async () => {
    const root = await makePluginDir(
      'browser',
      manifest('browser', {
        contributes: {
          toolingViews: [{ id: 'pages', title: 'Browser', icon: '◫' }],
        },
      }),
    );
    const host = new PluginHost({ registry: new ToolRegistry() });
    await host.discover(root);
    await host.activate('browser', { activate: () => undefined });

    expect(host.status().find((p) => p.id === 'browser')?.views[0]?.title).toBe(
      'Browser',
    );
  });
});
