/**
 * The plugin host (task 6.1): it reads a plugin's manifest without running
 * it, gives its Node half one context — the only way it reaches the machine —
 * and tears that context down as one: a failed activation leaves nothing,
 * nothing it launched survives it, a tool gets only what its declared effect
 * allows, and a project can turn off what the app runs.
 */

import type { PluginManifest, PluginNodeContext, PluginNodeModule, Verdict } from '@aparte/bonaparte-shared';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listFiles } from '../tools/builtin/list-files.js';
import { readFileTool } from '../tools/builtin/read-file.js';
import { webFetch } from '../tools/builtin/web-fetch.js';
import { writeFileTool } from '../tools/builtin/write-file.js';
import { ToolRegistry } from '../tools/registry.js';
import type { ToolContext } from '../tools/types.js';
import { PluginHost } from './host.js';
import { PluginState } from './state.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

type RawManifest = Partial<Omit<PluginManifest, 'contributes'>> & { contributes?: Record<string, unknown> };

const manifest = (id: string, extra: RawManifest = {}): RawManifest => ({
  id,
  name: { en: id, fr: id },
  version: '0.1.0',
  effects: [{ effect: 'read', what: 'the files of the project' }],
  ...extra,
});

const readTool = (name: string) => ({ name, description: `The tool ${name}.`, effect: 'read' as const });

function capture(body: (ctx: PluginNodeContext) => void | Promise<void> = () => undefined): PluginNodeModule & { ctx?: PluginNodeContext } {
  const module: PluginNodeModule & { ctx?: PluginNodeContext } = {
    async activate(ctx) {
      module.ctx = ctx;
      await body(ctx);
    },
  };
  return module;
}

function rig(options: { judge?: (use: { tool: { name: string; effect: string }; input: unknown }) => Verdict } = {}) {
  const registry = new ToolRegistry();
  for (const tool of [readFileTool, listFiles, writeFileTool, webFetch]) registry.register(tool.def, tool.handler);
  const logs: string[] = [];
  const host = new PluginHost({
    registry,
    log: (message) => logs.push(message),
    ...(options.judge ? { judge: options.judge } : {}),
  });
  return { registry, host, logs };
}

const context = (roots: readonly string[]): ToolContext => ({
  conversationId: 'c1',
  roots,
  nCtx: 8192,
  signal: new AbortController().signal,
});

describe('PluginHost — discovery', () => {
  let root: string;
  beforeEach(async () => {
    root = await tempDir('bp-plugins-');
  });

  const place = async (dir: string, raw: unknown): Promise<void> => {
    await mkdir(join(root, dir), { recursive: true });
    await writeFile(join(root, dir, 'plugin.json'), JSON.stringify(raw));
  };

  it('reads a manifest without running the plugin', async () => {
    await place('changelog', manifest('changelog', { entry: { node: 'index.js' } }));
    await writeFile(join(root, 'changelog', 'index.js'), "throw new Error('ran');");
    const { host } = rig();
    const [found] = await host.discover(root);
    expect(found).toMatchObject({ id: 'changelog', active: false, builtin: false });
    expect(found!.manifest?.entry.node).toBe('index.js');
  });

  it('keeps a manifest it refuses, with why, and never loads it', async () => {
    await place('broken', { id: 'broken', version: '' });
    const { host } = rig();
    const [found] = await host.discover(root);
    expect(found!.manifest).toBeUndefined();
    expect(found!.error).toContain('version');
    expect(host.status().find((one) => one.id === 'broken')?.error).toContain('version');
  });

  it('passes over a folder without a manifest', async () => {
    await mkdir(join(root, 'notes'));
    const { host } = rig();
    expect(await host.discover(root)).toEqual([]);
  });

  it('refuses a second plugin with the same id', async () => {
    await place('a', manifest('twin'));
    await place('b', manifest('twin'));
    const { host } = rig();
    const found = await host.discover(root);
    expect(found.filter((one) => one.error?.includes('already taken'))).toHaveLength(1);
  });
});

describe('PluginHost — one context, torn down as one', () => {
  it('a tool enters the registry once its handler is wired: a built-in keeps its name, another is named after its plugin', async () => {
    const { host, registry } = rig();
    host.add(manifest('notes', { contributes: { tools: [readTool('count_notes')] } }), { builtin: true });
    host.add(manifest('stranger', { contributes: { tools: [readTool('count_notes')] } }), { builtin: false });
    let wire: (() => void) | undefined;
    await host.activate('notes', capture((ctx) => {
      wire = () => ctx.registerToolHandler('count_notes', async () => ({ content: '3' }));
    }));
    expect(registry.get('count_notes')).toBeUndefined();
    wire!();
    expect(registry.get('count_notes')?.def).toMatchObject({ source: 'plugin', where: 'core', effect: 'read' });
    await host.activate('stranger', capture((ctx) => ctx.registerToolHandler('count_notes', async () => ({ content: '4' }))));
    expect(registry.get('plugin__stranger__count_notes')).toBeDefined();
    expect(host.status().find((one) => one.id === 'stranger')?.tools).toEqual(['plugin__stranger__count_notes']);
  });

  it('a teardown undoes everything at once: its tools, its commands, its signal, what it asked to undo', async () => {
    const { host, registry } = rig();
    host.add(manifest('notes', { contributes: { tools: [readTool('count_notes')] } }), { builtin: true });
    let disposed = 0;
    const module = capture((ctx) => {
      ctx.registerToolHandler('count_notes', async () => ({ content: '3' }));
      ctx.registerCommand('refresh', () => 'ok');
      ctx.onDispose(() => {
        disposed += 1;
      });
    });
    await host.activate('notes', module);
    expect(await host.invoke('notes', 'refresh', null)).toBe('ok');
    await host.deactivate('notes');
    expect(registry.get('count_notes')).toBeUndefined();
    await expect(host.invoke('notes', 'refresh', null)).rejects.toThrow(/not active/);
    expect(module.ctx!.signal.aborted).toBe(true);
    expect(disposed).toBe(1);
    expect(host.status()[0]).toMatchObject({ active: false });
  });

  it('a failed activation leaves nothing behind, and says why', async () => {
    const { host, registry } = rig();
    host.add(
      manifest('flaky', {
        effects: [{ effect: 'read', what: 'x' }, { effect: 'execute', what: 'node' }],
        contributes: { tools: [readTool('count_notes')] },
      }),
      { builtin: true },
    );
    let child: { pid: number | undefined } | undefined;
    const status = await host.activate(
      'flaky',
      capture((ctx) => {
        ctx.registerToolHandler('count_notes', async () => ({ content: '3' }));
        ctx.registerCommand('refresh', () => 'ok');
        child = ctx.spawn!(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
        throw new Error('boum');
      }),
    );
    expect(status).toMatchObject({ active: false });
    expect(status.error).toContain('boum');
    expect(registry.get('count_notes')).toBeUndefined();
    await expect(host.invoke('flaky', 'refresh', null)).rejects.toThrow(/not active/);
    expect(child?.pid).toBeDefined();
    expect(() => process.kill(child!.pid!, 0)).toThrow();
  });

  it('what a plugin registers after it went registers nothing', async () => {
    const { host, registry, logs } = rig();
    host.add(manifest('late', { contributes: { tools: [readTool('count_notes')] } }), { builtin: true });
    const module = capture();
    await host.activate('late', module);
    await host.deactivate('late');
    module.ctx!.registerToolHandler('count_notes', async () => ({ content: '3' }));
    module.ctx!.registerCommand('refresh', () => 'ok');
    expect(registry.get('count_notes')).toBeUndefined();
    await expect(host.invoke('late', 'refresh', null)).rejects.toThrow(/not active/);
    expect(logs.join('\n')).toContain('late');
  });

  it('a handler for a tool its manifest does not declare fails the activation', async () => {
    const { host, registry } = rig();
    host.add(manifest('sly'), { builtin: true });
    const status = await host.activate('sly', capture((ctx) => ctx.registerToolHandler('delete_all', async () => ({ content: '' }))));
    expect(status.error).toMatch(/not declared/);
    expect(registry.get('delete_all')).toBeUndefined();
  });

  it('nothing it launched survives its teardown', async () => {
    const { host } = rig();
    host.add(manifest('runner', { effects: [{ effect: 'execute', what: 'node' }] }), { builtin: true });
    let pid: number | undefined;
    await host.activate('runner', capture((ctx) => {
      pid = ctx.spawn!(process.execPath, ['-e', 'setInterval(() => {}, 1000)']).pid;
    }));
    expect(() => process.kill(pid!, 0)).not.toThrow();
    await host.deactivate('runner');
    expect(() => process.kill(pid!, 0)).toThrow();
  });

  it('starts a process only for a plugin that declares running one', async () => {
    const { host } = rig();
    host.add(manifest('reader'), { builtin: true });
    const module = capture();
    await host.activate('reader', module);
    expect(module.ctx!.spawn).toBeUndefined();
  });

  it('switched off for the app, a plugin is not activated; switched on again, it is, with the module it was given', async () => {
    const { host, registry } = rig();
    host.add(manifest('notes', { contributes: { tools: [readTool('count_notes')] } }), { builtin: true });
    const module = capture((ctx) => ctx.registerToolHandler('count_notes', async () => ({ content: '3' })));
    await host.activate('notes', module);
    await host.setEnabled('notes', false);
    expect(registry.get('count_notes')).toBeUndefined();
    expect(host.status()[0]).toMatchObject({ enabled: false, active: false });
    expect(await host.activate('notes', module)).toMatchObject({ enabled: false, active: false });
    await host.setEnabled('notes', true);
    expect(registry.get('count_notes')).toBeDefined();
    expect(host.status()[0]).toMatchObject({ enabled: true, active: true });
  });

  it('a setting is the one configured, else its default in the manifest', async () => {
    const registry = new ToolRegistry();
    const host = new PluginHost({ registry, config: (id, key) => (id === 'notes' && key === 'folder' ? 'docs' : undefined) });
    host.add(
      manifest('notes', {
        contributes: {
          settings: [
            { key: 'folder', label: 'Folder', type: 'string' },
            { key: 'max', label: 'Max', type: 'number', default: 20 },
          ],
        },
      }),
      { builtin: true },
    );
    const module = capture();
    await host.activate('notes', module);
    expect(module.ctx!.getConfig('folder')).toBe('docs');
    expect(module.ctx!.getConfig('max')).toBe(20);
    expect(module.ctx!.getConfig('other')).toBeUndefined();
  });

  it('says the panes and the effects of a plugin', async () => {
    const { host } = rig();
    host.add(manifest('notes', { contributes: { panes: [{ id: 'notes', title: { en: 'Notes', fr: 'Notes' } }] } }), { builtin: true });
    await host.activate('notes', capture());
    expect(host.status()[0]).toMatchObject({
      builtin: true,
      active: true,
      panes: [{ id: 'notes', multiple: false }],
      effects: [{ effect: 'read' }],
    });
  });
});

describe('PluginHost — a tool gets only what its effect allows', () => {
  let project: string;
  beforeEach(async () => {
    project = await tempDir('bp-plugin-project-');
    await writeFile(join(project, 'notes.txt'), 'un\ndeux\n');
  });

  const allowAll = (): Verdict => ({ verdict: 'allow' });

  it('a tool that reads may read with the core tools, and gets nothing to write with', async () => {
    const { host, registry } = rig({ judge: allowAll });
    host.add(manifest('notes', { contributes: { tools: [readTool('peek')] } }), { builtin: true });
    const seen: string[] = [];
    await host.activate('notes', capture((ctx) => {
      ctx.registerToolHandler('peek', async (call) => {
        const read = await call.use('read_file', { path: 'notes.txt' });
        const write = await call.use('write_file', { path: 'notes.txt', content: 'effacé' });
        seen.push(read.content, write.content);
        return { content: 'done' };
      });
    }));
    const result = await registry.run({ id: 't1', name: 'peek', input: {} }, context([project]));
    expect(result.content).toBe('done');
    expect(seen[0]).toContain('un');
    expect(seen[1]).toMatch(/declares the effect read.*write_file/s);
    expect(await readFile(join(project, 'notes.txt'), 'utf8')).toBe('un\ndeux\n');
  });

  it('a tool that writes may write in the perimeter, with the core tool', async () => {
    const { host, registry } = rig({ judge: allowAll });
    host.add(
      manifest('notes', {
        effects: [{ effect: 'read', what: 'x' }, { effect: 'write', what: 'notes.txt' }],
        contributes: { tools: [{ name: 'scribble', description: 'Scribble.', effect: 'write' }] },
      }),
      { builtin: true },
    );
    await host.activate('notes', capture((ctx) => {
      ctx.registerToolHandler('scribble', async (call) => call.use('write_file', { path: 'notes.txt', content: 'trois\n' }));
    }));
    const result = await registry.run({ id: 't1', name: 'scribble', input: {} }, context([project]));
    expect(result.failed).toBeUndefined();
    expect(await readFile(join(project, 'notes.txt'), 'utf8')).toBe('trois\n');
  });

  it('what the policy would ask the person (a file that runs later, a folder outside) is refused, never done', async () => {
    const asks = (use: { tool: { name: string }; input: unknown }): Verdict =>
      use.tool.name === 'write_file' ? { verdict: 'ask', why: 'armed-path' } : { verdict: 'allow' };
    const { host, registry } = rig({ judge: asks });
    host.add(
      manifest('notes', {
        effects: [{ effect: 'read', what: 'x' }, { effect: 'write', what: 'package.json' }],
        contributes: { tools: [{ name: 'scribble', description: 'Scribble.', effect: 'write' }] },
      }),
      { builtin: true },
    );
    await host.activate('notes', capture((ctx) => {
      ctx.registerToolHandler('scribble', async (call) => call.use('write_file', { path: 'package.json', content: '{}' }));
    }));
    const result = await registry.run({ id: 't1', name: 'scribble', input: {} }, context([project]));
    expect(result.failed).toBe(true);
    expect(result.content).toMatch(/approval/);
    await expect(readFile(join(project, 'package.json'), 'utf8')).rejects.toThrow();
    // Even when the person allowed the plugin's call itself: they never saw that path.
    const allowed = await registry.run({ id: 't2', name: 'scribble', input: {} }, { ...context([project]), granted: true });
    expect(allowed.failed).toBe(true);
    await expect(readFile(join(project, 'package.json'), 'utf8')).rejects.toThrow();
  });

  it('a call the person allowed may do what only the mode would ask about — in Répétition, the write they allowed', async () => {
    const byMode = (use: { tool: { name: string }; input: unknown }): Verdict =>
      use.tool.name === 'write_file' ? { verdict: 'ask', why: 'mode' } : { verdict: 'allow' };
    const { host, registry } = rig({ judge: byMode });
    host.add(
      manifest('notes', {
        effects: [{ effect: 'read', what: 'x' }, { effect: 'write', what: 'the notes' }],
        contributes: { tools: [{ name: 'scribble', description: 'Scribble.', effect: 'write' }] },
      }),
      { builtin: true },
    );
    await host.activate('notes', capture((ctx) => {
      ctx.registerToolHandler('scribble', async (call) => call.use('write_file', { path: 'notes.md', content: 'noted\n' }));
    }));
    // Not allowed by the person (a policy that let the call pass, a sub-call): refused.
    expect((await registry.run({ id: 't1', name: 'scribble', input: {} }, context([project]))).failed).toBe(true);
    await expect(readFile(join(project, 'notes.md'), 'utf8')).rejects.toThrow();
    // Allowed by the person: done.
    const done = await registry.run({ id: 't2', name: 'scribble', input: {} }, { ...context([project]), granted: true });
    expect(done.failed).toBeUndefined();
    expect(await readFile(join(project, 'notes.md'), 'utf8')).toBe('noted\n');
  });

  it('a tool that sends never reads the project, and a tool that is not the core’s cannot be used', async () => {
    const { host, registry } = rig({ judge: allowAll });
    host.add(
      manifest('sender', {
        effects: [{ effect: 'network', what: 'example.org' }],
        contributes: { tools: [{ name: 'send', description: 'Send.', effect: 'network' }] },
      }),
      { builtin: true },
    );
    const seen: string[] = [];
    await host.activate('sender', capture((ctx) => {
      ctx.registerToolHandler('send', async (call) => {
        seen.push((await call.use('read_file', { path: 'notes.txt' })).content);
        seen.push((await call.use('other', {})).content);
        return { content: 'sent' };
      });
    }));
    await registry.run({ id: 't1', name: 'send', input: {} }, context([project]));
    expect(seen[0]).toMatch(/declares the effect network/);
    expect(seen[1]).toMatch(/no tool of the core named other/);
  });
});

describe('PluginHost — a project turns off what the app runs', () => {
  it('its tools leave that project’s conversations and stay in the others; its commands refuse that project', async () => {
    const { host, registry } = rig();
    host.add(manifest('notes', { contributes: { tools: [readTool('count_notes')] } }), { builtin: true });
    await host.activate('notes', capture((ctx) => {
      ctx.registerToolHandler('count_notes', async () => ({ content: '3' }));
      ctx.registerCommand('refresh', () => 'ok');
    }));
    await host.setEnabled('notes', false, { projectId: 'p1' });

    const inP1 = registry.view(host.visibleTo('p1'));
    const inP2 = registry.view(host.visibleTo('p2'));
    expect(inP1.list().map((tool) => tool.name)).not.toContain('count_notes');
    expect(inP1.list().map((tool) => tool.name)).toContain('read_file');
    expect(inP2.list().map((tool) => tool.name)).toContain('count_notes');
    expect(registry.view(host.visibleTo(undefined)).list().map((tool) => tool.name)).toContain('count_notes');
    const refused = await inP1.run({ id: 't1', name: 'count_notes', input: {} }, context([]));
    expect(refused).toMatchObject({ failed: true });
    expect((await inP2.run({ id: 't2', name: 'count_notes', input: {} }, context([]))).content).toBe('3');

    await expect(host.invoke('notes', 'refresh', null, { projectId: 'p1' })).rejects.toThrow(/turned off for this project/);
    expect(await host.invoke('notes', 'refresh', null, { projectId: 'p2' })).toBe('ok');
    expect(host.status('p1')[0]).toMatchObject({ enabled: false, active: true });
    expect(host.status('p2')[0]).toMatchObject({ enabled: true, active: true });

    await host.setEnabled('notes', true, { projectId: 'p1' });
    expect(registry.view(host.visibleTo('p1')).list().map((tool) => tool.name)).toContain('count_notes');
  });
});

describe('PluginHost — terminals', () => {
  /** The app's terminals, recording what is done to them. */
  function fakeTerminals() {
    const opened: { shellId: string; env: Record<string, string> | undefined; killed: boolean }[] = [];
    const service = {
      shells: () => [{ id: 'bash', label: 'bash' }],
      open: (shellId: string, options: { env?: Record<string, string> }) => {
        const pty = { shellId, env: options.env, killed: false };
        opened.push(pty);
        return {
          pid: opened.length,
          write: () => undefined,
          resize: () => undefined,
          onData: () => undefined,
          onExit: () => undefined,
          kill: () => {
            pty.killed = true;
          },
          pause: () => undefined,
          resume: () => undefined,
        };
      },
    };
    return { opened, service };
  }

  it('a plugin that declares execute gets the terminals, killed when it goes; one that does not, gets none', async () => {
    const { opened, service } = fakeTerminals();
    const host = new PluginHost({ registry: new ToolRegistry(), terminals: service });
    host.add(manifest('shell', { effects: [{ effect: 'execute', what: 'a terminal' }] }), { builtin: true });
    host.add(manifest('reader', { effects: [{ effect: 'read', what: 'files' }] }), { builtin: true });
    const shell = capture();
    const reader = capture();
    await host.activate('shell', shell);
    await host.activate('reader', reader);
    expect(reader.ctx!.terminals).toBeUndefined();

    expect(shell.ctx!.terminals!.shells()).toEqual([{ id: 'bash', label: 'bash' }]);
    shell.ctx!.terminals!.open('bash', { cols: 80, rows: 24, env: { TERM: 'xterm-256color' } });
    expect(opened).toMatchObject([{ shellId: 'bash', env: { TERM: 'xterm-256color' }, killed: false }]);
    await host.deactivate('shell');
    expect(opened[0]!.killed).toBe(true);
    expect(() => shell.ctx!.terminals!.open('bash', { cols: 80, rows: 24 })).toThrow(/not active/);
  });

  it('without terminals from the app, a plugin gets none', async () => {
    const host = new PluginHost({ registry: new ToolRegistry() });
    host.add(manifest('shell', { effects: [{ effect: 'execute', what: 'a terminal' }] }), { builtin: true });
    const shell = capture();
    await host.activate('shell', shell);
    expect(shell.ctx!.terminals).toBeUndefined();
  });
});

describe('PluginHost — the web search (task 10.4)', () => {
  it('a plugin that declares network may search the web, until it goes; one that does not, may not', async () => {
    const asked: string[] = [];
    const webSearch = {
      search: async (query: string) => {
        asked.push(query);
        return { provider: 'embedded', results: [{ title: 'A', url: 'https://a.example', snippet: 'a' }] };
      },
    };
    const host = new PluginHost({ registry: new ToolRegistry(), webSearch });
    host.add(manifest('searcher', { effects: [{ effect: 'network', what: 'the web' }] }), { builtin: true });
    host.add(manifest('reader', { effects: [{ effect: 'read', what: 'files' }] }), { builtin: true });
    const searcher = capture();
    const reader = capture();
    await host.activate('searcher', searcher);
    await host.activate('reader', reader);
    expect(reader.ctx!.search).toBeUndefined();
    expect(await searcher.ctx!.search!('kv cache', 3)).toMatchObject({ provider: 'embedded', results: [{ url: 'https://a.example' }] });
    expect(asked).toEqual(['kv cache']);
    await host.deactivate('searcher');
    await expect(searcher.ctx!.search!('again', 3)).rejects.toThrow(/not active/);
  });
});

describe('PluginHost — the built-in browser (task 10.1)', () => {
  it('a plugin that declares network gets the browser, until it goes; one that does not, gets none', async () => {
    const opened: string[] = [];
    const browser = {
      open: async (url: string) => {
        opened.push(url);
        return { url, title: 'Page' };
      },
      read: async () => null,
      screenshot: async () => null,
      act: async () => ({ done: 'clicked' }),
    };
    const host = new PluginHost({ registry: new ToolRegistry(), browser });
    host.add(manifest('pages', { effects: [{ effect: 'network', what: 'pages' }] }), { builtin: true });
    host.add(manifest('reader', { effects: [{ effect: 'read', what: 'files' }] }), { builtin: true });
    const pages = capture();
    const reader = capture();
    await host.activate('pages', pages);
    await host.activate('reader', reader);
    expect(reader.ctx!.browser).toBeUndefined();
    expect(await pages.ctx!.browser!.open('http://localhost:5173/')).toEqual({ url: 'http://localhost:5173/', title: 'Page' });
    await host.deactivate('pages');
    await expect(pages.ctx!.browser!.open('http://x')).rejects.toThrow(/not active/);
    expect(opened).toEqual(['http://localhost:5173/']);
  });

  it('reading the page needs read declared, acting on it execute: network alone only opens (review of phase 10)', async () => {
    const browser = {
      open: async (url: string) => ({ url, title: 'Page' }),
      read: async () => ({ url: 'http://x/', title: 'x', text: 'secret', console: [] }),
      screenshot: async () => null,
      act: async () => ({ done: 'clicked' }),
    };
    const host = new PluginHost({ registry: new ToolRegistry(), browser });
    host.add(manifest('opener', { effects: [{ effect: 'network', what: 'pages' }] }), { builtin: true });
    host.add(manifest('reader', { effects: [{ effect: 'network', what: 'pages' }, { effect: 'read', what: 'pages' }] }), { builtin: true });
    const opener = capture();
    const reader = capture();
    await host.activate('opener', opener);
    await host.activate('reader', reader);
    await expect(opener.ctx!.browser!.read()).rejects.toThrow(/read/);
    await expect(opener.ctx!.browser!.screenshot()).rejects.toThrow(/read/);
    await expect(opener.ctx!.browser!.act({ kind: 'click', selector: 'button' })).rejects.toThrow(/execute/);
    expect(await reader.ctx!.browser!.read()).toMatchObject({ text: 'secret' });
    await expect(reader.ctx!.browser!.act({ kind: 'click', selector: 'button' })).rejects.toThrow(/execute/);
  });

  it('a file of the conversation’s folders opens as a read, its folder the only one its page may load from; nothing outside them (Paul, 2026-11-20)', async () => {
    const project = await tempDir('bp-host-file-');
    const elsewhere = await tempDir('bp-host-elsewhere-');
    await mkdir(join(project, 'bac'));
    await writeFile(join(project, 'bac', 'snake.html'), '<title>Snake</title>');
    await writeFile(join(elsewhere, 'secret.html'), 'no');
    const opened: [string, string, { network: boolean }][] = [];
    const browser = {
      open: async (url: string) => ({ url, title: 'Page' }),
      openFile: async (path: string, root: string, options: { network: boolean }) => {
        opened.push([path, root, options]);
        return { url: `file:///${path}`, title: 'Snake' };
      },
      read: async () => null,
      screenshot: async () => null,
      act: async () => ({ done: 'clicked' }),
    };
    // What each conversation may: a discussion reaches no file; the network without asking (Impro) or not.
    const fileAccess = async (conversationId: string) =>
      conversationId === 'discussion' ? { files: false, network: false } : { files: true, network: conversationId === 'impro' };
    const host = new PluginHost({ registry: new ToolRegistry(), browser, fileAccess });
    host.add(manifest('opener', { effects: [{ effect: 'network', what: 'pages' }] }), { builtin: true });
    host.add(manifest('reader', { effects: [{ effect: 'network', what: 'pages' }, { effect: 'read', what: 'files' }] }), { builtin: true });
    const opener = capture();
    const reader = capture();
    await host.activate('opener', opener);
    await host.activate('reader', reader);
    const from = (conversationId: string) => ({ conversationId, roots: [project] });
    // A file is read: a plugin that does not declare read opens none.
    await expect(opener.ctx!.browser!.openFile('bac/snake.html', from('plume'))).rejects.toThrow(/read/);
    expect(await reader.ctx!.browser!.openFile('bac/snake.html', from('plume'))).toEqual({ url: `file:///${join(project, 'bac', 'snake.html')}`, title: 'Snake', offline: true });
    // Its page reaches the network only where the conversation may without asking (review of 2026-11-20).
    await reader.ctx!.browser!.openFile('bac/snake.html', from('impro'));
    expect(opened).toEqual([
      [join(project, 'bac', 'snake.html'), project, { network: false }],
      [join(project, 'bac', 'snake.html'), project, { network: true }],
    ]);
    // Outside the folders, a folder, a file that is not there, a discussion: refused, with words the model can act on.
    expect(await reader.ctx!.browser!.openFile(join(elsewhere, 'secret.html'), from('plume'))).toMatchObject({ error: expect.stringMatching(/outside/i) });
    expect(await reader.ctx!.browser!.openFile('bac', from('plume'))).toMatchObject({ error: expect.stringMatching(/not a file/i) });
    expect(await reader.ctx!.browser!.openFile('bac/none.html', from('plume'))).toMatchObject({ error: expect.stringMatching(/no file/i) });
    expect(await reader.ctx!.browser!.openFile('bac/snake.html', from('discussion'))).toMatchObject({ error: expect.stringMatching(/discussion/i) });
    expect(opened).toHaveLength(2);
  });
});

describe('PluginHost — what is switched off is kept (task 11.1)', () => {
  it('a plugin switched off before a restart is not activated after it, and can be switched on again', async () => {
    const file = join(await tempDir('bp-host-state-'), 'plugins.json');
    const first = new PluginHost({ registry: new ToolRegistry(), state: await PluginState.open(file) });
    first.add(manifest('notes', { contributes: { tools: [readTool('note_read')] } }), { builtin: true });
    await first.activate('notes', capture());
    await first.setEnabled('notes', false);
    await first.setEnabled('notes', false, { projectId: 'p1' });

    const registry = new ToolRegistry();
    const again = new PluginHost({ registry, state: await PluginState.open(file) });
    again.add(manifest('notes', { contributes: { tools: [readTool('note_read')] } }), { builtin: true });
    await again.activate('notes', capture());
    expect(again.status()[0]).toMatchObject({ enabled: false, active: false });
    expect(registry.get('note_read')).toBeUndefined();
    await again.setEnabled('notes', true);
    expect(again.status()[0]).toMatchObject({ enabled: true, active: true });
    expect(again.isEnabled('notes', 'p1')).toBe(false);
  });
});

describe('PluginHost — what changed is told', () => {
  it('each start, stop, removal and switch is told to whoever listens', async () => {
    const host = new PluginHost({ registry: new ToolRegistry() });
    const told: number[] = [];
    let count = 0;
    const off = host.onChange(() => told.push((count += 1)));
    host.add({ id: 'notes', name: 'Notes', version: '1.0.0' }, { builtin: true });
    await host.activate('notes', { activate: () => undefined });
    expect(told.length).toBeGreaterThanOrEqual(1);
    const afterStart = told.length;
    await host.setEnabled('notes', false);
    expect(told.length).toBeGreaterThan(afterStart);
    const afterOff = told.length;
    await host.forget('notes');
    expect(told.length).toBeGreaterThan(afterOff);
    off();
    const before = told.length;
    host.add({ id: 'other', name: 'Other', version: '1.0.0' }, { builtin: true });
    await host.activate('other', { activate: () => undefined });
    expect(told.length).toBe(before);
  });
});
