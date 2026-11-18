/**
 * A plugin of a third party in a process of its own (task 11.1): it talks to the app by messages only. Its tools
 * enter the one registry, named after it, and reach the core's own tools only through `use`, within their declared
 * effect; a call stopped stops there too; its process gone, the plugin goes with all it added — the app stays.
 * The process here is a pair of ports in this test's own Node: the messages are the same as across processes.
 */

import type { PluginNodeModule } from '@aparte/bonaparte-shared';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileTool } from '../tools/builtin/read-file.js';
import { writeFileTool } from '../tools/builtin/write-file.js';
import { ToolRegistry } from '../tools/registry.js';
import type { ToolContext } from '../tools/types.js';
import { PluginHost } from './host.js';
import { runPluginChild, type PluginChildPort, type PluginPort } from './remote.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A process of a test: two ports, each message copied as it would cross; it can crash. */
function processOf(module: unknown) {
  const toChild: ((message: unknown) => void)[] = [];
  const toParent: ((message: unknown) => void)[] = [];
  const exits: ((code: number | null) => void)[] = [];
  let killed = false;
  const send = (to: ((message: unknown) => void)[], message: unknown): void => {
    const copied = structuredClone(message);
    queueMicrotask(() => to.forEach((listener) => listener(copied)));
  };
  const parent: PluginPort = {
    postMessage: (message) => send(toChild, message),
    onMessage: (listener) => void toParent.push(listener as (message: unknown) => void),
    onExit: (listener) => void exits.push(listener),
    kill: () => {
      if (killed) return;
      killed = true;
      exits.forEach((listener) => listener(null));
    },
  };
  const child: PluginChildPort = {
    postMessage: (message) => {
      if (!killed) send(toParent, message);
    },
    onMessage: (listener) => void toChild.push(listener as (message: unknown) => void),
  };
  runPluginChild(child, async () => module);
  return {
    parent,
    crash: (code: number) => exits.forEach((listener) => listener(code)),
    killed: () => killed,
    /** A message the plugin's code sends by itself, past its context. */
    inject: (message: unknown) => send(toParent, message),
  };
}

const MANIFEST = {
  id: 'revue-pr',
  name: 'Revue PR',
  version: '0.3.0',
  entry: { node: 'index.mjs' },
  effects: [{ effect: 'read', what: 'the files of the project' }],
  contributes: {
    tools: [{ name: 'peek', description: 'Peek at the notes.', effect: 'read' }],
    commands: [{ name: 'hello', description: 'Say hello' }],
    settings: [{ key: 'greeting', label: 'Greeting', type: 'string', default: 'Bonjour' }],
  },
};

async function rig(module: unknown) {
  const project = await mkdtemp(join(tmpdir(), 'bp-remote-'));
  dirs.push(project);
  await writeFile(join(project, 'notes.txt'), 'un\ndeux\n');
  const registry = new ToolRegistry();
  for (const tool of [readFileTool, writeFileTool]) registry.register(tool.def, tool.handler);
  const host = new PluginHost({ registry, judge: () => ({ verdict: 'allow' }) });
  host.add(MANIFEST, { builtin: false, dir: project });
  const process = processOf(module);
  const status = await host.activateRemote('revue-pr', () => process.parent);
  const context: ToolContext = { conversationId: 'c1', roots: [project], nCtx: 8192, signal: new AbortController().signal };
  return { host, registry, process, status, project, context };
}

describe('a plugin of a third party, in its own process (task 11.1)', () => {
  it('its tool enters the registry under its name, and reads through the core within its effect — never writes', async () => {
    const module: PluginNodeModule = {
      activate(ctx) {
        ctx.registerToolHandler('peek', async (call) => {
          const read = await call.use('read_file', { path: 'notes.txt' });
          const write = await call.use('write_file', { path: 'notes.txt', content: 'effacé' });
          return { content: `${read.content.includes('deux') ? 'read' : 'no'} / ${write.failed ? 'refused' : 'written'} / ${ctx.getConfig('greeting')}` };
        });
      },
    };
    const { registry, status, context } = await rig(module);
    expect(status).toMatchObject({ active: true, tools: ['plugin__revue-pr__peek'] });
    expect(registry.get('plugin__revue-pr__peek')?.def).toMatchObject({ source: 'extension', effect: 'read' });
    const result = await registry.run({ id: 't1', name: 'plugin__revue-pr__peek', input: {} }, context);
    expect(result.content).toBe('read / refused / Bonjour');
  });

  it('a call stopped is stopped in its process too', async () => {
    let aborted = false;
    const module: PluginNodeModule = {
      activate(ctx) {
        ctx.registerToolHandler('peek', (call) => new Promise((resolve) => call.signal.addEventListener('abort', () => {
          aborted = true;
          resolve({ content: 'stopped', failed: true });
        })));
      },
    };
    const { registry, context } = await rig(module);
    const controller = new AbortController();
    const running = registry.run({ id: 't1', name: 'plugin__revue-pr__peek', input: {} }, { ...context, signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await running;
    await vi.waitFor(() => expect(aborted).toBe(true));
  });

  it('its « / » command answers through its process', async () => {
    const module: PluginNodeModule = {
      activate(ctx) {
        ctx.registerCommand('hello', (payload) => ({ send: `hello ${String((payload as { name: string }).name)}` }));
      },
    };
    const { host } = await rig(module);
    expect(await host.invoke('revue-pr', 'hello', { name: 'Paul' })).toEqual({ send: 'hello Paul' });
  });

  it('its process gone, the plugin goes with all it added, its reason said — the app stays', async () => {
    const module: PluginNodeModule = { activate: (ctx) => ctx.registerToolHandler('peek', async () => ({ content: 'x' })) };
    const { host, registry, process } = await rig(module);
    process.crash(3);
    await vi.waitFor(() => expect(registry.get('plugin__revue-pr__peek')).toBeUndefined());
    expect(host.status()[0]).toMatchObject({ active: false, error: expect.stringMatching(/stopped/) });
  });

  it('switched off, its process is told to undo what it did, then stopped', async () => {
    let undone = false;
    const module: PluginNodeModule = {
      activate(ctx) {
        ctx.registerToolHandler('peek', async () => ({ content: 'x' }));
        ctx.onDispose(() => {
          undone = true;
        });
      },
    };
    const { host, registry, process } = await rig(module);
    await host.setEnabled('revue-pr', false);
    expect(registry.get('plugin__revue-pr__peek')).toBeUndefined();
    await vi.waitFor(() => expect(undone).toBe(true));
    expect(process.killed()).toBe(true);
  });

  it('a module that fails to start leaves nothing, and says why', async () => {
    const module: PluginNodeModule = {
      activate(ctx) {
        ctx.registerToolHandler('peek', async () => ({ content: 'x' }));
        throw new Error('no token');
      },
    };
    const { registry, status, process } = await rig(module);
    expect(status).toMatchObject({ active: false, error: expect.stringMatching(/no token/) });
    expect(registry.get('plugin__revue-pr__peek')).toBeUndefined();
    expect(process.killed()).toBe(true);
  });

  it('a tool its manifest does not declare fails the plugin alone, said — the app stays', async () => {
    const module: PluginNodeModule = { activate: (ctx) => ctx.registerToolHandler('commits_today', async () => ({ content: 'x' })) };
    const { status, process } = await rig(module);
    expect(status).toMatchObject({ active: false, error: expect.stringMatching(/commits_today/) });
    expect(process.killed()).toBe(true);
  });

  it('a tool registered twice fails the plugin alone, said — the app stays', async () => {
    const module: PluginNodeModule = {
      activate(ctx) {
        ctx.registerToolHandler('peek', async () => ({ content: 'x' }));
        ctx.registerToolHandler('peek', async () => ({ content: 'y' }));
      },
    };
    const { status, registry, process } = await rig(module);
    expect(status).toMatchObject({ active: false, error: expect.stringMatching(/peek/) });
    expect(registry.get('plugin__revue-pr__peek')).toBeUndefined();
    expect(process.killed()).toBe(true);
  });

  it('a message of no known shape, once it runs, stops the plugin alone, said — the app stays', async () => {
    const module: PluginNodeModule = { activate: (ctx) => ctx.registerToolHandler('peek', async () => ({ content: 'x' })) };
    const { host, registry, process } = await rig(module);
    process.inject(null);
    process.inject({ t: 'result', id: 1 });
    await vi.waitFor(() => expect(registry.get('plugin__revue-pr__peek')).toBeUndefined());
    expect(process.killed()).toBe(true);
    expect(host.status()[0]).toMatchObject({ active: false, error: expect.stringMatching(/message/) });
  });

  it('a core tool that throws under its `use` answers the plugin as a failure — nothing rejects in the app', async () => {
    const unhandled: unknown[] = [];
    const listen = (reason: unknown): void => void unhandled.push(reason);
    process.on('unhandledRejection', listen);
    try {
      const module: PluginNodeModule = {
        activate(ctx) {
          ctx.registerToolHandler('peek', async (call) => {
            const used = await call.use('read_file', { path: 'a\u0000b' });
            return { content: used.failed ? `failed: ${used.content}` : 'read' };
          });
        },
      };
      const { registry, context, host } = await rig(module);
      // The judge itself throws, as a path the file system refuses makes it.
      (host as unknown as { options: { judge: () => never } }).options.judge = () => {
        throw new Error('judge broke');
      };
      const result = await registry.run({ id: 't1', name: 'plugin__revue-pr__peek', input: {} }, context);
      expect(result.content).toMatch(/^failed: .*judge broke/);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listen);
    }
  });

  it('a result it cannot read ends its call as failed — the turn never waits for ever', async () => {
    const module: PluginNodeModule = { activate: (ctx) => ctx.registerToolHandler('peek', () => new Promise(() => undefined)) };
    const { registry, context, process } = await rig(module);
    const running = registry.run({ id: 't1', name: 'plugin__revue-pr__peek', input: {} }, context);
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.inject({ t: 'result', id: 1, result: { content: { toString: 1 } } });
    const result = await Promise.race([running, new Promise((resolve) => setTimeout(() => resolve('HUNG'), 2_000))]);
    expect(result).toMatchObject({ failed: true });
  });

  it('a file that is no plugin module is said', async () => {
    const { status } = await rig({ nothing: true });
    expect(status).toMatchObject({ active: false, error: expect.stringMatching(/activate/) });
  });
});
