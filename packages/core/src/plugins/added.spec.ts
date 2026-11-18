/**
 * The plugins the person adds (task 11.1), from adding to removing: a plugin added and switched on runs in its own
 * process, its tools in the one registry; added without being switched on, nothing of it runs; after a restart each
 * comes back as it was; a newer version is proposed; removed, it leaves no tool, no folder, no trace in the state.
 * Its process is a pair of ports in this test's Node, loading its real file from disk.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolRegistry } from '../tools/registry.js';
import { AddedPlugins } from './added.js';
import { PluginHost } from './host.js';
import { PluginInstaller } from './install.js';
import { runPluginChild, type PluginChildPort, type PluginPort } from './remote.js';

const dirs: string[] = [];
const hosts: PluginHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.deactivateAll()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
});

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

let started = 0;

/** A process of the test: its Node half really imported from its folder. */
function start(): PluginPort {
  const toChild: ((message: unknown) => void)[] = [];
  const toParent: ((message: unknown) => void)[] = [];
  const exits: ((code: number | null) => void)[] = [];
  let killed = false;
  const child: PluginChildPort = {
    postMessage: (message) => !killed && queueMicrotask(() => toParent.forEach((listener) => listener(structuredClone(message)))),
    onMessage: (listener) => void toChild.push(listener as (message: unknown) => void),
  };
  // A new process imports afresh: this Node keeps what it imported, so each start asks its own copy.
  started += 1;
  runPluginChild(child, (file) => import(`${pathToFileURL(file).href}?process=${started}`));
  return {
    postMessage: (message) => queueMicrotask(() => toChild.forEach((listener) => listener(structuredClone(message)))),
    onMessage: (listener) => void toParent.push(listener as (message: unknown) => void),
    onExit: (listener) => void exits.push(listener),
    kill: () => {
      if (killed) return;
      killed = true;
      exits.forEach((listener) => listener(null));
    },
  };
}

async function pluginFolder(version = '0.3.0'): Promise<string> {
  const dir = await temp('bp-added-src-');
  await writeFile(
    join(dir, 'plugin.json'),
    JSON.stringify({
      id: 'revue-pr',
      name: 'Revue PR',
      version,
      entry: { node: 'index.mjs' },
      effects: [{ effect: 'read', what: 'the files of the project' }],
      contributes: { tools: [{ name: 'peek', description: 'Peek.', effect: 'read' }] },
    }),
  );
  await writeFile(join(dir, 'index.mjs'), `export default { activate(ctx) { ctx.registerToolHandler('peek', async () => ({ content: 'v${version}' })); } };\n`);
  return dir;
}

async function rig(data: string) {
  const registry = new ToolRegistry();
  const host = new PluginHost({ registry, stateFile: join(data, 'config', 'plugins.json') });
  hosts.push(host);
  const installer = new PluginInstaller({ dataDir: data, env: () => ({ ...process.env }) as Record<string, string> });
  const added = new AddedPlugins({ host, installer, start: () => start(), now: () => new Date('2026-11-18T10:00:00.000Z') });
  return { registry, host, added };
}

describe('the plugins the person adds (task 11.1)', () => {
  it('added and switched on, it runs in its process; added without, nothing of it runs — and each is as it was after a restart', async () => {
    const data = await temp('bp-added-data-');
    const { registry, added } = await rig(data);
    const preview = await added.preview({ kind: 'folder', path: await pluginFolder() });
    if (!preview.ok) throw new Error(preview.error);
    expect(await added.install(preview.preview.stagingId, { enable: true })).toMatchObject({
      id: 'revue-pr',
      active: true,
      enabled: true,
      tools: ['plugin__revue-pr__peek'],
      source: { kind: 'folder' },
    });
    const ran = await registry.run({ id: 't1', name: 'plugin__revue-pr__peek', input: {} }, { conversationId: 'c1', roots: [data], nCtx: 8192, signal: new AbortController().signal });
    expect(ran.content).toBe('v0.3.0');
    await added.host.setEnabled('revue-pr', false);

    const again = await rig(data);
    await again.added.start();
    expect(again.host.status().find((one) => one.id === 'revue-pr')).toMatchObject({ enabled: false, active: false, source: { kind: 'folder' } });
    expect(again.registry.get('plugin__revue-pr__peek')).toBeUndefined();
    await again.host.setEnabled('revue-pr', true);
    expect(again.registry.get('plugin__revue-pr__peek')).toBeDefined();
  });

  it('a plugin put in <data>/plugins/ by hand is started, said to come from its own folder', async () => {
    const data = await temp('bp-added-data-');
    const { cp } = await import('node:fs/promises');
    await cp(await pluginFolder(), join(data, 'plugins', 'revue-pr'), { recursive: true });
    const { host, added } = await rig(data);
    await added.start();
    expect(host.status().find((one) => one.id === 'revue-pr')).toMatchObject({ active: true, source: { kind: 'folder', path: join(data, 'plugins', 'revue-pr') } });
  });

  it('« Ajouter sans activer »: kept, switched off, nothing run', async () => {
    const data = await temp('bp-added-data-');
    const { registry, added } = await rig(data);
    const preview = await added.preview({ kind: 'folder', path: await pluginFolder() });
    if (!preview.ok) throw new Error(preview.error);
    expect(await added.install(preview.preview.stagingId, { enable: false })).toMatchObject({ id: 'revue-pr', enabled: false, active: false });
    expect(registry.get('plugin__revue-pr__peek')).toBeUndefined();
  });

  it('added again in a newer version, the newer one runs in place of the other', async () => {
    const data = await temp('bp-added-data-');
    const { registry, added } = await rig(data);
    const first = await added.preview({ kind: 'folder', path: await pluginFolder('0.3.0') });
    if (!first.ok) throw new Error(first.error);
    await added.install(first.preview.stagingId, { enable: true });
    const newer = await added.preview({ kind: 'folder', path: await pluginFolder('0.4.0') });
    if (!newer.ok) throw new Error(newer.error);
    expect(newer.preview.replaces).toBe('0.3.0');
    expect(await added.install(newer.preview.stagingId, { enable: true })).toMatchObject({ version: '0.4.0', active: true });
    const ran = await registry.run({ id: 't1', name: 'plugin__revue-pr__peek', input: {} }, { conversationId: 'c1', roots: [data], nCtx: 8192, signal: new AbortController().signal });
    expect(ran.content).toBe('v0.4.0');
  });

  it('removed, it leaves no tool, no folder and nothing in the state', async () => {
    const data = await temp('bp-added-data-');
    const { registry, host, added } = await rig(data);
    const preview = await added.preview({ kind: 'folder', path: await pluginFolder() });
    if (!preview.ok) throw new Error(preview.error);
    await added.install(preview.preview.stagingId, { enable: true });
    await added.remove('revue-pr');
    expect(registry.get('plugin__revue-pr__peek')).toBeUndefined();
    expect(existsSync(join(data, 'plugins', 'revue-pr'))).toBe(false);
    expect(host.status().find((one) => one.id === 'revue-pr')).toBeUndefined();
    expect((await host.keptState()).installed()).toEqual([]);
  });

  it('a built-in cannot be removed, nor taken over by a plugin of the same id', async () => {
    const data = await temp('bp-added-data-');
    const { host, added } = await rig(data);
    host.add({ id: 'revue-pr', name: 'Built in', version: '1.0.0' }, { builtin: true });
    const preview = await added.preview({ kind: 'folder', path: await pluginFolder() });
    expect(preview).toMatchObject({ ok: false, error: expect.stringMatching(/built-in/) });
    await expect(added.remove('revue-pr')).rejects.toThrow(/built-in/);
  });
});

describe('a plugin made in a conversation, tried and installed (task 11.4)', () => {
  async function extensionOf(data: string) {
    const { ExtensionStore } = await import('./extensions.js');
    const store = new ExtensionStore({ dataDir: data, env: () => ({ ...process.env }) as Record<string, string> });
    const defined = await store.define('c1', {
      manifest: {
        id: 'changelog',
        name: 'Changelog',
        version: '0.1.0',
        effects: [{ effect: 'read', what: 'nothing' }],
        contributes: { tools: [{ name: 'today', description: 'The commits of the day.', effect: 'read' }] },
      },
      code: "export default { activate(ctx) { ctx.registerToolHandler('today', async () => ({ content: '3 commits' })); } };\n",
    });
    if (!defined.ok) throw new Error(defined.error);
    return defined.extension;
  }

  it('tried, its tools are seen by its conversation only; stopped, they go', async () => {
    const data = await temp('bp-added-data-');
    const { registry, host, added } = await rig(data);
    const extension = await extensionOf(data);
    expect(await added.tryExtension(extension)).toMatchObject({ id: 'changelog', active: true, trial: 'c1' });
    const tool = registry.get('plugin__changelog__today')!.def;
    expect(host.visibleTo(undefined, 'c1')(tool)).toBe(true);
    expect(host.visibleTo(undefined, 'c2')(tool)).toBe(false);
    await added.stopTrial('changelog');
    expect(registry.get('plugin__changelog__today')).toBeUndefined();
  });

  it('installed, it is a plugin like the others — said to come from its conversation — and comes back after a restart', async () => {
    const data = await temp('bp-added-data-');
    const { added } = await rig(data);
    const extension = await extensionOf(data);
    await added.tryExtension(extension);
    expect(await added.installExtension(extension, 'Une commande /changelog')).toMatchObject({
      id: 'changelog',
      active: true,
      source: { kind: 'conversation', conversationId: 'c1', title: 'Une commande /changelog' },
    });
    expect(added.host.status().find((one) => one.id === 'changelog')?.trial).toBeUndefined();
    const again = await rig(data);
    await again.added.start();
    expect(again.registry.get('plugin__changelog__today')).toBeDefined();
  });
});
