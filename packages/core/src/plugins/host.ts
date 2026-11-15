/**
 * The plugin host (task 6.1). A plugin's manifest is read without running
 * it; its Node half is given one context, the only way it reaches the
 * machine; and that context is torn down as one, by the host — a plugin never
 * undoes its registrations by hand.
 *
 * - A failed activation leaves nothing: its tools, its commands, its views'
 *   channels, the processes it started and whatever it asked to undo all go.
 * - Nothing it launched survives it: a process goes through `ctx.spawn`
 *   (hidden, an argument array, only for a plugin that declares `execute`),
 *   and is stopped with its children at teardown.
 * - A tool gets only what its declared effect allows: it reaches the files,
 *   the commands and the network through the core's own tools, each judged
 *   by the approval policy as the agent's own call would be — a use the
 *   person would be asked about is refused, never done in their name.
 * - A project can turn off what the app runs: the plugin's tools leave that
 *   project's conversations (`visibleTo`), its commands refuse it.
 * - Its events reach its views with back-pressure, per view (VS Code's
 *   thresholds): `emit` says when to stop, `onDrain` when to go on.
 *
 * A built-in plugin is trusted code built with the app (lint keeps it from
 * reaching the machine any other way); a third-party plugin runs in its own
 * process (task 11.1).
 */

import {
  parseManifest,
  usableEffects,
  type PluginInstanceChannel,
  type PluginManifest,
  type PluginNodeContext,
  type PluginNodeModule,
  type PluginProcess,
  type PluginPty,
  type PluginStatus,
  type PluginToolContribution,
  type PluginToolHandler,
  type TerminalService,
  type Verdict,
} from '@aparte/bonaparte-shared';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpawnedProcess, SpawnFn } from '../process/spawn.js';
import { spawnTree, stopProcessTree } from '../process/tree.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolContext, ToolDef, ToolHandler, ToolOutput } from '../tools/types.js';

export const PLUGIN_MANIFEST_FILE = 'plugin.json';

/** VS Code's thresholds (`FlowControlConstants`), counted in characters, per view. */
export const FLOW_CONTROL = { highWatermark: 100_000, lowWatermark: 5_000, ackSize: 5_000 } as const;

export interface PluginHostOptions {
  registry: ToolRegistry;
  /** A plugin's setting, as the person set it; undefined falls back to the manifest's default. */
  config?: (pluginId: string, key: string) => unknown;
  log?: (message: string) => void;
  /** An event of a plugin for one of its views (instance '' is the default one). */
  emit?: (pluginId: string, instanceId: string, event: string, payload: unknown) => void;
  /**
   * The approval policy, for each core tool a plugin's tool uses, in its
   * conversation. Without it only reads pass.
   */
  judge?: (use: { conversationId: string; tool: ToolDef; input: unknown }) => Verdict | Promise<Verdict>;
  /** Tests only: what launches a plugin's processes. */
  spawn?: SpawnFn;
  /** The terminals the app gives (run in a process of its own); none without it. */
  terminals?: TerminalService;
}

export interface DiscoveredPlugin {
  id: string;
  dir?: string;
  manifest?: PluginManifest;
  error?: string;
  builtin: boolean;
  active: boolean;
}

interface Flow {
  unacknowledged: number;
  paused: boolean;
  drained: (() => void)[];
}

/** Everything one activation registered: what the host tears down, as one. */
interface Activation {
  closed: boolean;
  abort: AbortController;
  tools: string[];
  commands: Map<string, (payload: unknown) => unknown>;
  flows: Map<string, Flow>;
  processes: Set<SpawnedProcess>;
  /** Its terminals, killed at teardown. */
  ptys: Set<PluginPty>;
  disposers: (() => void | Promise<void>)[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sizeOf = (payload: unknown): number => {
  if (typeof payload === 'string') return payload.length;
  try {
    return JSON.stringify(payload)?.length ?? 0;
  } catch {
    return 0;
  }
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const onlyReads = ({ tool }: { tool: ToolDef }): Verdict =>
  tool.effect === 'read' ? { verdict: 'allow' } : { verdict: 'ask', why: 'mode' };

export class PluginHost {
  private readonly plugins = new Map<string, DiscoveredPlugin>();
  private readonly activations = new Map<string, Activation>();
  /** The module each plugin was activated with: switched on again, it comes back with it. */
  private readonly modules = new Map<string, PluginNodeModule>();
  private readonly disabled = new Set<string>();
  private readonly disabledFor = new Map<string, Set<string>>();
  /** Which plugin owns a tool of the registry. */
  private readonly owners = new Map<string, string>();
  private readonly log: (message: string) => void;

  constructor(private readonly options: PluginHostOptions) {
    this.log = options.log ?? (() => undefined);
  }

  /** A plugin, from its manifest: a built-in one keeps its tools' names, another is named after it. */
  add(raw: unknown, options: { builtin?: boolean; dir?: string } = {}): DiscoveredPlugin {
    const builtin = options.builtin ?? false;
    const parsed = parseManifest(raw);
    const id = parsed.ok ? parsed.manifest.id : isRecord(raw) && typeof raw['id'] === 'string' ? raw['id'] : (options.dir ?? 'unknown');
    const where = options.dir ? { dir: options.dir } : {};
    let plugin: DiscoveredPlugin;
    if (this.plugins.has(id)) {
      plugin = { id: `${id} (${options.dir ?? 'again'})`, ...where, builtin, active: false, error: `The identifier ${id} is already taken by another plugin.` };
      this.plugins.set(plugin.id, plugin);
      return plugin;
    }
    plugin = parsed.ok
      ? { id, ...where, manifest: parsed.manifest, builtin, active: false }
      : { id, ...where, builtin, active: false, error: parsed.error };
    this.plugins.set(id, plugin);
    return plugin;
  }

  /** The plugins of a folder, one per subfolder with a manifest; none of them runs. */
  async discover(root: string): Promise<DiscoveredPlugin[]> {
    const found: DiscoveredPlugin[] = [];
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      let text: string;
      try {
        text = await readFile(join(dir, PLUGIN_MANIFEST_FILE), 'utf8');
      } catch {
        continue;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (error) {
        const plugin: DiscoveredPlugin = { id: entry.name, dir, builtin: false, active: false, error: `${PLUGIN_MANIFEST_FILE} is not JSON: ${describe(error)}` };
        this.plugins.set(plugin.id, plugin);
        found.push(plugin);
        continue;
      }
      found.push(this.add(raw, { dir }));
    }
    return found;
  }

  get(id: string): DiscoveredPlugin | undefined {
    return this.plugins.get(id);
  }

  /** Runs a plugin's Node half; a failure is kept in its status, and leaves nothing behind. */
  async activate(id: string, module: PluginNodeModule): Promise<PluginStatus> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`There is no plugin ${id}.`);
    this.modules.set(id, module);
    if (!plugin.manifest || this.disabled.has(id) || this.activations.has(id)) return this.statusOf(plugin);
    const manifest = plugin.manifest;
    const activation: Activation = {
      closed: false,
      abort: new AbortController(),
      tools: [],
      commands: new Map(),
      flows: new Map(),
      processes: new Set(),
      ptys: new Set(),
      disposers: [],
    };
    this.activations.set(id, activation);
    delete plugin.error;
    try {
      await module.activate(this.contextFor(plugin, manifest, activation));
      plugin.active = !activation.closed;
    } catch (error) {
      plugin.error = describe(error);
      this.log(`[plugin ${id}] activation failed: ${plugin.error}`);
      await this.teardown(id);
    }
    return this.statusOf(plugin);
  }

  async deactivate(id: string): Promise<void> {
    await this.teardown(id);
  }

  async deactivateAll(): Promise<void> {
    for (const id of [...this.activations.keys()]) await this.teardown(id);
  }

  /** A command of a plugin's view. */
  async invoke(id: string, command: string, payload: unknown, options: { projectId?: string } = {}): Promise<unknown> {
    const activation = this.activations.get(id);
    if (!activation || activation.closed) throw new Error(`The plugin ${id} is not active.`);
    if (options.projectId && this.disabledFor.get(options.projectId)?.has(id)) {
      throw new Error(`The plugin ${id} is turned off for this project.`);
    }
    const handler = activation.commands.get(command);
    if (!handler) throw new Error(`The plugin ${id} has no command ${command}.`);
    return handler(payload);
  }

  /** A view displayed `chars` more of what it was sent. */
  acknowledge(id: string, instanceId: string, chars: number): void {
    const flow = this.activations.get(id)?.flows.get(instanceId);
    if (!flow || !(chars > 0)) return;
    flow.unacknowledged = Math.max(0, flow.unacknowledged - chars);
    if (flow.paused && flow.unacknowledged < FLOW_CONTROL.lowWatermark) {
      flow.paused = false;
      for (const listener of [...flow.drained]) listener();
    }
  }

  /**
   * Switched off for the app, a plugin is torn down; on again, it comes back
   * with the module it was given. For a project, it only leaves that
   * project's conversations: a project turns off what the app runs.
   */
  async setEnabled(id: string, enabled: boolean, options: { projectId?: string } = {}): Promise<void> {
    if (options.projectId) {
      const off = this.disabledFor.get(options.projectId) ?? new Set<string>();
      if (enabled) off.delete(id);
      else off.add(id);
      this.disabledFor.set(options.projectId, off);
      return;
    }
    if (enabled) {
      this.disabled.delete(id);
      const module = this.modules.get(id);
      if (module) await this.activate(id, module);
      return;
    }
    this.disabled.add(id);
    await this.teardown(id);
  }

  isEnabled(id: string, projectId?: string): boolean {
    return !this.disabled.has(id) && !(projectId !== undefined && this.disabledFor.get(projectId)?.has(id));
  }

  /** Which tools a conversation of this project sees: a plugin its project turned off is not there. */
  visibleTo(projectId: string | undefined): (def: ToolDef) => boolean {
    return (def) => {
      if (def.source !== 'plugin' && def.source !== 'extension') return true;
      const owner = this.owners.get(def.name);
      return owner === undefined || this.isEnabled(owner, projectId);
    };
  }

  status(projectId?: string): PluginStatus[] {
    return [...this.plugins.values()].map((plugin) => this.statusOf(plugin, projectId));
  }

  private statusOf(plugin: DiscoveredPlugin, projectId?: string): PluginStatus {
    const manifest = plugin.manifest;
    return {
      id: plugin.id,
      name: manifest?.name ?? plugin.id,
      version: manifest?.version ?? '',
      ...(manifest?.description ? { description: manifest.description } : {}),
      builtin: plugin.builtin,
      effects: manifest?.effects ?? [],
      enabled: this.isEnabled(plugin.id, projectId),
      active: plugin.active,
      ...(plugin.error ? { error: plugin.error } : {}),
      panes: plugin.active ? (manifest?.contributes.panes ?? []) : [],
      tools: [...(this.activations.get(plugin.id)?.tools ?? [])],
    };
  }

  private toolName(plugin: DiscoveredPlugin, name: string): string {
    return plugin.builtin ? name : `plugin__${plugin.id}__${name}`;
  }

  private contextFor(plugin: DiscoveredPlugin, manifest: PluginManifest, activation: Activation): PluginNodeContext {
    const id = plugin.id;
    // What a plugin does once it went does nothing, and is said.
    const live = (what: string): boolean => {
      if (!activation.closed) return true;
      this.log(`[plugin ${id}] ${what} after the plugin went: ignored.`);
      return false;
    };
    const declares = new Set(manifest.effects.map((one) => one.effect));
    const context: PluginNodeContext = {
      pluginId: id,
      signal: activation.abort.signal,
      registerToolHandler: (name, handler) => {
        if (!live(`the tool ${name}`)) return;
        const tool = manifest.contributes.tools.find((one) => one.name === name);
        if (!tool) throw new Error(`The tool ${name} is not declared in the manifest of ${id}.`);
        const registered = this.toolName(plugin, name);
        this.options.registry.register(this.defOf(plugin, tool, registered), this.adapt(registered, tool, handler, activation));
        this.owners.set(registered, id);
        activation.tools.push(registered);
      },
      registerCommand: (name, handler) => {
        if (!live(`the command ${name}`)) return;
        activation.commands.set(name, handler);
      },
      getConfig: <T>(key: string): T | undefined => {
        const set = this.options.config?.(id, key);
        if (set !== undefined) return set as T;
        return manifest.contributes.settings.find((one) => one.key === key)?.default as T | undefined;
      },
      emit: (event, payload) => this.channelFor(id, activation, '').emit(event, payload),
      onDrain: (listener) => this.flowOf(activation, '').drained.push(listener),
      channel: (instanceId) => this.channelFor(id, activation, instanceId),
      onDispose: (dispose) => {
        if (live('onDispose')) activation.disposers.push(dispose);
      },
      log: (message) => this.log(`[plugin ${id}] ${message}`),
    };
    if (declares.has('execute')) {
      context.spawn = (program, args, options = {}) => {
        if (activation.closed) throw new Error(`The plugin ${id} is not active.`);
        const child = spawnTree(program, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.env ? { env: options.env } : {}),
          ...(this.options.spawn ? { spawn: this.options.spawn } : {}),
        });
        activation.processes.add(child);
        child.once('exit', () => activation.processes.delete(child));
        child.on('error', (error) => this.log(`[plugin ${id}] ${program}: ${describe(error)}`));
        return wrapProcess(child, this.options.spawn);
      };
      const service = this.options.terminals;
      if (service) {
        context.terminals = {
          shells: () => service.shells(),
          open: (shellId, options) => {
            if (activation.closed) throw new Error(`The plugin ${id} is not active.`);
            const pty = service.open(shellId, options);
            activation.ptys.add(pty);
            pty.onExit(() => activation.ptys.delete(pty));
            return pty;
          },
        };
      }
    }
    return context;
  }

  private defOf(plugin: DiscoveredPlugin, tool: PluginToolContribution, name: string): ToolDef {
    return {
      name,
      description: tool.description,
      inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
      effect: tool.effect,
      source: plugin.builtin ? 'plugin' : 'extension',
      where: 'core',
    };
  }

  /** A plugin's tool, run as the registry runs any: what it may use is what its effect allows. */
  private adapt(name: string, tool: PluginToolContribution, handler: PluginToolHandler, activation: Activation): ToolHandler {
    const usable = usableEffects(tool.effect);
    return async (call, ctx): Promise<ToolOutput> => {
      if (activation.closed) return { content: `The tool ${name} is no longer available.`, failed: true };
      const use = async (inner: string, input: Record<string, unknown>): Promise<{ content: string; failed?: boolean }> => {
        const core = this.options.registry.get(inner);
        if (!core || core.def.source !== 'builtin' || core.def.where !== 'core') {
          return { content: `There is no tool of the core named ${inner}.`, failed: true };
        }
        if (!usable.includes(core.def.effect)) {
          return {
            content: `Not done: the tool ${name} declares the effect ${tool.effect}, so it cannot use ${inner} (effect ${core.def.effect}).`,
            failed: true,
          };
        }
        const judge = this.options.judge ?? onlyReads;
        const verdict = await judge({ conversationId: ctx.conversationId, tool: core.def, input });
        if (verdict.verdict === 'deny') return { content: `Not done: ${verdict.reason}`, failed: true };
        // The person allowed this very call of the plugin: what only the mode asks about is what they
        // allowed. Anything asked for another reason (a file that runs later, outside the perimeter, the
        // network) they never saw — refused.
        if (verdict.verdict === 'ask' && !(ctx.granted === true && verdict.why === 'mode')) {
          return {
            content: `Not done: ${inner} here needs the person's approval, which a plugin's tool cannot ask for. Do it with your own tools, so that the person is asked.`,
            failed: true,
          };
        }
        // The person allowed the plugin's call, not what it reaches: nothing lands outside the perimeter on its word.
        const inside: ToolContext = { ...ctx, granted: false };
        const output = await core.handler({ id: `${call.id}/${inner}`, name: inner, input }, inside);
        return { content: output.content, ...(output.failed ? { failed: true } : {}) };
      };
      const result = await handler({
        input: isRecord(call.input) ? call.input : {},
        conversationId: ctx.conversationId,
        roots: ctx.roots,
        signal: ctx.signal,
        use,
      });
      return { content: String(result.content), ...(result.failed ? { failed: true } : {}) };
    };
  }

  private flowOf(activation: Activation, instanceId: string): Flow {
    let flow = activation.flows.get(instanceId);
    if (!flow) {
      flow = { unacknowledged: 0, paused: false, drained: [] };
      activation.flows.set(instanceId, flow);
    }
    return flow;
  }

  private channelFor(id: string, activation: Activation, instanceId: string): PluginInstanceChannel {
    let disposed = false;
    return {
      emit: (event, payload) => {
        if (disposed || activation.closed || this.activations.get(id) !== activation) return false;
        const flow = this.flowOf(activation, instanceId);
        this.options.emit?.(id, instanceId, event, payload);
        flow.unacknowledged += sizeOf(payload);
        if (flow.unacknowledged >= FLOW_CONTROL.highWatermark) flow.paused = true;
        return !flow.paused;
      },
      onDrain: (listener) => {
        if (!disposed && !activation.closed) this.flowOf(activation, instanceId).drained.push(listener);
      },
      dispose: () => {
        disposed = true;
        activation.flows.delete(instanceId);
      },
    };
  }

  /** Everything the activation registered goes, as one; each undoing is isolated from the others. */
  private async teardown(id: string): Promise<void> {
    const activation = this.activations.get(id);
    const plugin = this.plugins.get(id);
    if (plugin) plugin.active = false;
    if (!activation || activation.closed) {
      this.activations.delete(id);
      return;
    }
    activation.closed = true;
    // No new call reaches it while it goes.
    for (const name of activation.tools) {
      this.options.registry.unregister(name);
      this.owners.delete(name);
    }
    activation.commands.clear();
    activation.abort.abort();
    for (const dispose of activation.disposers.reverse()) {
      try {
        await dispose();
      } catch (error) {
        this.log(`[plugin ${id}] an undoing failed: ${describe(error)}`);
      }
    }
    await Promise.all([...activation.processes].map((child) => stopProcessTree(child, this.options.spawn ? { spawn: this.options.spawn } : {})));
    for (const pty of activation.ptys) {
      try {
        pty.kill();
      } catch (error) {
        this.log(`[plugin ${id}] a terminal did not stop: ${describe(error)}`);
      }
    }
    activation.ptys.clear();
    activation.flows.clear();
    this.activations.delete(id);
  }
}

function wrapProcess(child: SpawnedProcess, spawn: SpawnFn | undefined): PluginProcess {
  return {
    pid: child.pid,
    write: (data) => {
      child.stdin?.write(data);
    },
    onOutput: (listener) => {
      child.stdout?.on('data', (chunk: Buffer) => listener(chunk.toString('utf8'), 'stdout'));
      child.stderr?.on('data', (chunk: Buffer) => listener(chunk.toString('utf8'), 'stderr'));
    },
    onExit: (listener) => {
      child.once('exit', (code) => listener(code));
    },
    kill: () => stopProcessTree(child, spawn ? { spawn } : {}),
  };
}
