/**
 * The tools that make a plugin in a conversation (task 11.4): what each mode lets them do — define refused in
 * Lecture, asked in Répétition, let through in Plume and Impro; run refused in Lecture, asked in Répétition and in
 * Plume, let through in Impro; the interface tools and the inspection everywhere —; inspect gives the guide; define
 * compiles and keeps a revision; run tries it here only; stop and undefine take it away.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PlayMode } from '@aparte/bonaparte-shared';
import { afterEach, describe, expect, it } from 'vitest';
import { PermissionEngine } from '../../permissions/engine.js';
import { AddedPlugins } from '../../plugins/added.js';
import { ExtensionStore } from '../../plugins/extensions.js';
import { PluginHost } from '../../plugins/host.js';
import { PluginInstaller } from '../../plugins/install.js';
import { runPluginChild, type PluginChildPort, type PluginPort } from '../../plugins/remote.js';
import { ToolRegistry } from '../registry.js';
import { extensionTools } from './extensions.js';

const dirs: string[] = [];
const hosts: PluginHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.deactivateAll()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

let started = 0;
function start(): PluginPort {
  const toChild: ((message: unknown) => void)[] = [];
  const toParent: ((message: unknown) => void)[] = [];
  const exits: ((code: number | null) => void)[] = [];
  let killed = false;
  const child: PluginChildPort = {
    postMessage: (message) => !killed && queueMicrotask(() => toParent.forEach((listener) => listener(structuredClone(message)))),
    onMessage: (listener) => void toChild.push(listener as (message: unknown) => void),
  };
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

async function rig() {
  const data = await mkdtemp(join(tmpdir(), 'bp-extension-tools-'));
  dirs.push(data);
  const registry = new ToolRegistry();
  const host = new PluginHost({ registry, stateFile: join(data, 'config', 'plugins.json') });
  hosts.push(host);
  const env = () => ({ ...process.env }) as Record<string, string>;
  const store = new ExtensionStore({ dataDir: data, env });
  const added = new AddedPlugins({ host, installer: new PluginInstaller({ dataDir: data, env }), start: () => start() });
  for (const tool of extensionTools({ store, added, registry })) registry.register(tool.def, tool.handler);
  const ctx = (conversationId: string) => ({ conversationId, roots: [data], nCtx: 8192, signal: new AbortController().signal });
  return { registry, host, ctx };
}

const MANIFEST = {
  id: 'changelog',
  name: 'Changelog',
  version: '0.1.0',
  effects: [{ effect: 'read', what: 'nothing' }],
  contributes: { tools: [{ name: 'today', description: 'The commits of the day.', effect: 'read' }], commands: [{ name: 'changelog', description: 'Sum up the day' }] },
};
const CODE = "export default { activate(ctx) { ctx.registerToolHandler('today', async () => ({ content: '3 commits' })); } };\n";

describe('the tools that make a plugin (task 11.4)', () => {
  it('what each mode lets them do', async () => {
    const { registry } = await rig();
    const engine = new PermissionEngine({ roots: () => [tmpdir()], dataDir: join(tmpdir(), 'bp-none') });
    const verdict = (name: string, mode: PlayMode) => engine.evaluate({ tool: registry.get(name)!.def, input: { id: 'changelog' }, mode }).verdict;
    const modes: PlayMode[] = ['lecture', 'repetition', 'plume', 'impro'];
    expect(modes.map((mode) => verdict('harness_inspect', mode))).toEqual(['allow', 'allow', 'allow', 'allow']);
    expect(modes.map((mode) => verdict('extension_define', mode))).toEqual(['deny', 'ask', 'allow', 'allow']);
    expect(modes.map((mode) => verdict('extension_run', mode))).toEqual(['deny', 'ask', 'ask', 'allow']);
    expect(modes.map((mode) => verdict('extension_stop', mode))).toEqual(['allow', 'allow', 'allow', 'allow']);
    expect(modes.map((mode) => verdict('extension_undefine', mode))).toEqual(['allow', 'allow', 'allow', 'allow']);
  });

  it('inspect gives the plugins, the tools and the guide; define keeps a revision for the card; a code that does not compile says what to fix', async () => {
    const { registry, ctx } = await rig();
    const inspected = await registry.run({ id: 't1', name: 'harness_inspect', input: {} }, ctx('c1'));
    expect(inspected.content).toContain('# Making a bonaparte plugin');
    expect(inspected.content).toContain('extension_define');
    const defined = await registry.run({ id: 't2', name: 'extension_define', input: { manifest: MANIFEST, code: CODE } }, ctx('c1'));
    expect(defined.content).toMatch(/revision 1/);
    expect(defined.structuredContent).toMatchObject({ extension: { conversationId: 'c1', id: 'changelog', rev: 1, manifest: { version: '0.1.0' } } });
    const broken = await registry.run({ id: 't3', name: 'extension_define', input: { manifest: MANIFEST, code: 'export default {' } }, ctx('c1'));
    expect(broken).toMatchObject({ failed: true, content: expect.stringMatching(/does not compile/) });
  });

  it('run tries it in its conversation only; stop and undefine take it away', async () => {
    const { registry, host, ctx } = await rig();
    expect((await registry.run({ id: 't0', name: 'extension_run', input: { id: 'changelog' } }, ctx('c1'))).content).toMatch(/No plugin changelog was defined/);
    await registry.run({ id: 't1', name: 'extension_define', input: { manifest: MANIFEST, code: CODE } }, ctx('c1'));
    const ran = await registry.run({ id: 't2', name: 'extension_run', input: { id: 'changelog' } }, ctx('c1'));
    expect(ran.content).toMatch(/runs in this conversation[\s\S]*plugin__changelog__today[\s\S]*\/changelog/);
    const tool = registry.get('plugin__changelog__today')!.def;
    expect(host.visibleTo(undefined, 'c1')(tool)).toBe(true);
    expect(host.visibleTo(undefined, 'c2')(tool)).toBe(false);
    // Another conversation's stop or undefine leaves this trial as it is.
    expect((await registry.run({ id: 't2b', name: 'extension_stop', input: { id: 'changelog' } }, ctx('c2'))).content).toMatch(/No trial of changelog runs in this conversation/);
    await registry.run({ id: 't2c', name: 'extension_undefine', input: { id: 'changelog' } }, ctx('c2'));
    expect(registry.get('plugin__changelog__today')).toBeDefined();
    await registry.run({ id: 't3', name: 'extension_stop', input: { id: 'changelog' } }, ctx('c1'));
    expect(registry.get('plugin__changelog__today')).toBeUndefined();
    await registry.run({ id: 't4', name: 'extension_undefine', input: { id: 'changelog' } }, ctx('c1'));
    expect((await registry.run({ id: 't5', name: 'extension_run', input: { id: 'changelog' } }, ctx('c1'))).content).toMatch(/No plugin changelog was defined/);
  });
});
