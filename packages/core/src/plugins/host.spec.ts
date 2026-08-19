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

describe('PluginHost — découverte', () => {
  it('lit un manifeste valide SANS exécuter le plugin', async () => {
    const root = await makePluginDir('terminal', manifest('terminal'));
    const host = new PluginHost({ registry: new ToolRegistry() });

    const found = await host.discover(root);

    expect(found.map((p) => p.id)).toEqual(['terminal']);
    expect(found[0]?.error).toBeUndefined();
  });

  it('signale un manifeste invalide au lieu de le charger', async () => {
    // `id` en majuscules : refusé par le schéma.
    const root = await makePluginDir('bad', { id: 'BAD', name: 'x', version: '1' });
    const host = new PluginHost({ registry: new ToolRegistry() });

    const found = await host.discover(root);

    expect(found).toHaveLength(1);
    expect(found[0]?.error).toBeTruthy();
    expect(found[0]?.active).toBe(false);
  });

  it('ignore un dossier sans manifeste', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bp-plugins-'));
    dirs.push(root);
    await mkdir(join(root, 'pas-un-plugin'), { recursive: true });
    const host = new PluginHost({ registry: new ToolRegistry() });

    expect(await host.discover(root)).toEqual([]);
  });

  it('refuse un second plugin réclamant le même identifiant', async () => {
    const root = await makePluginDir('dupe', manifest('dupe'));
    // Un deuxième dossier dont le manifeste revendique le même id.
    await mkdir(join(root, 'autre'), { recursive: true });
    await writeFile(
      join(root, 'autre', 'plugin.json'),
      JSON.stringify(manifest('dupe')),
      'utf8',
    );
    const host = new PluginHost({ registry: new ToolRegistry() });

    const found = await host.discover(root);
    const rejected = found.filter((p) => p.error);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.error).toMatch(/identifiant/i);
  });
});

describe('PluginHost — activation réversible', () => {
  const withTool = (id: string) =>
    manifest(id, {
      contributes: {
        agentTools: [
          { name: 'demo_tool', description: 'un outil de démo', effect: 'read' },
        ],
      },
    });

  it('n’ajoute l’outil à l’inventaire qu’une fois le handler branché', async () => {
    const root = await makePluginDir('demo', withTool('demo'));
    const registry = new ToolRegistry();
    const host = new PluginHost({ registry });
    await host.discover(root);

    // Le manifeste déclare l'outil, mais rien ne l'exécute encore.
    expect(registry.list()).toHaveLength(0);

    await host.activate('demo', {
      activate: (ctx) => {
        ctx.registerToolHandler('demo_tool', async () => ({ ok: true, content: 'ok' }));
      },
    });

    expect(registry.list().map((t) => t.name)).toEqual(['demo_tool']);
  });

  it('défait TOUT au démontage, sans que le plugin ait à s’en occuper', async () => {
    // C'est l'invariant du contrat : la réversibilité est dans la primitive.
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

  it('refuse un handler pour un outil non déclaré au manifeste', async () => {
    // Le manifeste doit rester lisible sans exécuter le plugin : un outil qui
    // apparaîtrait seulement à l'activation le rendrait mensonger.
    const root = await makePluginDir('demo', withTool('demo'));
    const host = new PluginHost({ registry: new ToolRegistry() });
    await host.discover(root);

    await expect(
      host.activate('demo', {
        activate: (ctx) => {
          ctx.registerToolHandler('outil_clandestin', async () => ({
            ok: true,
            content: '',
          }));
        },
      }),
    ).rejects.toThrow(/non déclaré/i);
  });

  it('un plugin qui explose à l’activation ne laisse rien derrière lui', async () => {
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

    // L'inventaire ne doit pas garder l'outil d'un plugin à moitié activé.
    expect(registry.list()).toHaveLength(0);
    const status = host.status().find((p) => p.id === 'demo');
    expect(status?.active).toBe(false);
    expect(status?.error).toContain('boum');
  });

  it('expose les vues contribuées par les plugins actifs', async () => {
    const root = await makePluginDir(
      'browser',
      manifest('browser', {
        contributes: {
          toolingViews: [{ id: 'pages', title: 'Navigateur', icon: '◫' }],
        },
      }),
    );
    const host = new PluginHost({ registry: new ToolRegistry() });
    await host.discover(root);
    await host.activate('browser', { activate: () => undefined });

    expect(host.status().find((p) => p.id === 'browser')?.views[0]?.title).toBe(
      'Navigateur',
    );
  });
});
