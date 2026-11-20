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
  type WebSearchService,
  type BrowserCaller,
  type BrowserService,
  type Verdict,
} from '@aparte/bonaparte-shared';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { contains, realLocation, resolveInPerimeter } from '../project/paths.js';
import { withoutSecrets } from '../process/env.js';
import type { SpawnedProcess, SpawnFn } from '../process/spawn.js';
import { spawnTree, stopProcessTree } from '../process/tree.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolContext, ToolDef, ToolHandler, ToolOutput } from '../tools/types.js';
import { PluginState } from './state.js';
import { remoteModule, type PluginPort } from './remote.js';
import { CORE_ENTRIES, OFF_BY_DEFAULT } from './entries.js';

export const PLUGIN_MANIFEST_FILE = 'plugin.json';

/** VS Code's thresholds (`FlowControlConstants`), counted in characters, per view. */
export const FLOW_CONTROL = { highWatermark: 100_000, lowWatermark: 5_000, ackSize: 5_000 } as const;

export interface PluginHostOptions {
  registry: ToolRegistry;
  /** What is switched off, kept across restarts (task 11.1); without it, in memory only. */
  state?: PluginState;
  /** Or the file it is kept in, opened at the first activation (the core is made synchronously). */
  stateFile?: string;
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
  /**
   * What a conversation's page opened from a file may: reach a file at all (a discussion reaches none), and the
   * network without asking (Impro, or « ask before the network » off). Without it: files, offline. And the project
   * the conversation is in: whose session its agent's tab of the browser lives in (the browser redo, step 2).
   */
  fileAccess?: (conversationId: string) => Promise<{ files: boolean; network: boolean; projectId?: string }>;
  /** Tests only: what launches a plugin's processes. */
  spawn?: SpawnFn;
  /** The terminals the app gives (run in a process of its own); none without it. */
  terminals?: TerminalService;
  /** The web search the app gives (task 10.4); none without it. */
  webSearch?: WebSearchService;
  /** The built-in browser the app gives (task 10.1); none without it. */
  browser?: BrowserService;
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

/**
 * A file the model named, opened in the built-in browser: where it really lands must be a file of the perimeter
 * (the project's folders, or the home folder), and its page may load only from the folder of the perimeter that
 * holds it. A refusal is words the model can act on.
 */
async function openPerimeterFile(
  browser: BrowserService,
  requested: string,
  roots: readonly string[],
  network: boolean,
  from: BrowserCaller,
): Promise<{ url: string; title: string } | { error: string }> {
  const home = homedir();
  let real: string;
  try {
    real = realLocation(resolveInPerimeter(roots, requested, home));
  } catch (error) {
    return { error: `Not opened: ${describe(error)}` };
  }
  const found = await stat(real).catch(() => null);
  if (!found) return { error: `There is no file at ${requested}: give the path of a page in the project, an .html file.` };
  if (!found.isFile()) return { error: `${requested} is not a file: give the path of a page in it, an .html file.` };
  const root = (roots.length > 0 ? roots : [home]).map((one) => realLocation(resolve(one))).find((one) => contains(one, real)) ?? dirname(real);
  return browser.openFile(real, root, { network, ...from });
}

const onlyReads = ({ tool }: { tool: ToolDef }): Verdict =>
  tool.effect === 'read' ? { verdict: 'allow' } : { verdict: 'ask', why: 'mode' };

export class PluginHost {
  private readonly plugins = new Map<string, DiscoveredPlugin>();
  private readonly activations = new Map<string, Activation>();
  /** The module each plugin was activated with: switched on again, it comes back with it. */
  private readonly modules = new Map<string, PluginNodeModule>();
  /** What is switched off, for the app or a project: kept in `config/plugins.json` when a state is given. */
  private state: PluginState | null;
  /** A plugin made in a conversation, tried there and there only (task 11.4): that conversation. */
  private readonly trials = new Map<string, string>();
  /** Which plugin owns a tool of the registry. */
  private readonly owners = new Map<string, string>();
  private readonly log: (message: string) => void;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: PluginHostOptions) {
    this.log = options.log ?? (() => undefined);
    this.state = options.state ?? null;
  }

  /**
   * Told whenever what the plugins are changes — one started, stopped, crashed, removed, switched, tried: the app
   * tells the window, whoever made the change (the person, the model's tools, a process that ended).
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        this.log(`a listener of the plugins failed: ${describe(error)}`);
      }
    }
  }

  /** What is kept of the plugins: opened at the first need. */
  async keptState(): Promise<PluginState> {
    return this.stateOf();
  }

  private async stateOf(): Promise<PluginState> {
    this.state ??= await PluginState.open(this.options.stateFile ?? null);
    if (this.state.error) this.log(this.state.error);
    return this.state;
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
  /**
   * A plugin of a third party, in a process of its own (task 11.1): `start` gives the app's end of that process,
   * where its Node half is loaded. A plugin with no Node half (a view only) starts nothing. Its process gone, the
   * plugin goes with all it added, and says why: switched on again, it starts again.
   */
  async activateRemote(id: string, start: () => PluginPort): Promise<PluginStatus> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`There is no plugin ${id}.`);
    const manifest = plugin.manifest;
    const file = manifest?.entry.node && plugin.dir ? join(plugin.dir, manifest.entry.node) : null;
    const module: PluginNodeModule = file
      ? remoteModule({
          start,
          file,
          settings: manifest!.contributes.settings.map((setting) => setting.key),
          onCrash: (code, reason) => {
            plugin.error = `${reason ?? `Its process stopped${code === null ? '' : ` (code ${code})`}.`} Switch it on again to restart it.`;
            this.log(`[plugin ${id}] ${plugin.error}`);
            void this.teardown(id);
          },
        })
      : { activate: () => undefined };
    return this.activate(id, module);
  }

  async activate(id: string, module: PluginNodeModule): Promise<PluginStatus> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`There is no plugin ${id}.`);
    this.modules.set(id, module);
    const state = await this.stateOf();
    if (!plugin.manifest || state.isOff(id) || this.activations.has(id)) return this.statusOf(plugin);
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
    this.changed();
    return this.statusOf(plugin);
  }

  async deactivate(id: string): Promise<void> {
    await this.teardown(id);
  }

  /** The built-in entries of the core (task 11.3): listed and switched as plugins, with nothing of their own to run. */
  async activateBuiltinEntries(): Promise<void> {
    for (const entry of CORE_ENTRIES) {
      if (!this.plugins.has(entry.id)) this.add(entry, { builtin: true });
      await this.activate(entry.id, { activate: () => undefined });
    }
  }

  /** A plugin removed, or about to be replaced by a newer one: torn down, then forgotten. */
  async forget(id: string): Promise<void> {
    await this.teardown(id);
    this.plugins.delete(id);
    this.modules.delete(id);
    this.trials.delete(id);
    this.changed();
  }

  async deactivateAll(): Promise<void> {
    for (const id of [...this.activations.keys()]) await this.teardown(id);
  }

  /** A command of a plugin's view. */
  async invoke(id: string, command: string, payload: unknown, options: { projectId?: string } = {}): Promise<unknown> {
    const activation = this.activations.get(id);
    if (!activation || activation.closed) throw new Error(`The plugin ${id} is not active.`);
    if (options.projectId && this.state?.isOff(id, options.projectId)) {
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
    const state = await this.stateOf();
    if (options.projectId) {
      await state.setOff(id, !enabled, options.projectId);
      this.changed();
      return;
    }
    // Off by default (`OFF_BY_DEFAULT`): the person's « on » is what is kept.
    if (OFF_BY_DEFAULT.has(id)) {
      await state.setOn(id, enabled);
      if (!enabled) await this.teardown(id);
      this.changed();
      return;
    }
    if (enabled) {
      await state.setOff(id, false);
      const module = this.modules.get(id);
      if (module) await this.activate(id, module);
      return;
    }
    await state.setOff(id, true);
    await this.teardown(id);
    this.changed();
  }

  isEnabled(id: string, projectId?: string): boolean {
    return !(this.state?.isOff(id, projectId, OFF_BY_DEFAULT.has(id)) ?? OFF_BY_DEFAULT.has(id));
  }

  /**
   * Which tools a conversation sees: a plugin its project turned off is not there, nor one tried in another
   * conversation (task 11.4).
   */
  visibleTo(projectId: string | undefined, conversationId?: string): (def: ToolDef) => boolean {
    return (def) => {
      if (def.source !== 'plugin' && def.source !== 'extension') return true;
      const owner = this.owners.get(def.name);
      if (owner === undefined) return true;
      const trial = this.trials.get(owner);
      if (trial !== undefined && trial !== conversationId) return false;
      return this.isEnabled(owner, projectId);
    };
  }

  /** A plugin made in a conversation is tried there only — or, null, no longer a trial (task 11.4). */
  trialIn(id: string, conversationId: string | null): void {
    if (conversationId) this.trials.set(id, conversationId);
    else this.trials.delete(id);
  }

  status(projectId?: string): PluginStatus[] {
    return [...this.plugins.values()].map((plugin) => this.statusOf(plugin, projectId));
  }

  private statusOf(plugin: DiscoveredPlugin, projectId?: string): PluginStatus {
    const manifest = plugin.manifest;
    const added = plugin.builtin ? undefined : this.state?.get(plugin.id);
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
      ...(added?.source ? { source: added.source } : {}),
      ...(added?.update ? { update: added.update } : {}),
      ...(!plugin.builtin && manifest?.entry.view ? { view: manifest.entry.view } : {}),
      ...(this.trials.has(plugin.id) ? { trial: this.trials.get(plugin.id)! } : {}),
      ...(plugin.active && manifest?.contributes.commands.length ? { commands: manifest.contributes.commands } : {}),
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
          // A plugin's process never inherits the app's secrets, whatever it passes (audit 13.4).
          env: options.env ? withoutSecrets(options.env) : withoutSecrets(process.env),
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
    const searching = this.options.webSearch;
    if (declares.has('network') && searching) {
      context.search = async (query, max, signal) => {
        if (activation.closed) throw new Error(`The plugin ${id} is not active.`);
        // The call's signal, and the plugin's going: either stops the search.
        const stop = new AbortController();
        for (const one of [signal, activation.abort.signal]) {
          if (!one) continue;
          if (one.aborted) stop.abort();
          else one.addEventListener('abort', () => stop.abort());
        }
        return searching.search(query, max, stop.signal);
      };
    }
    const browser = this.options.browser;
    if (declares.has('network') && browser) {
      const live = <T>(run: () => Promise<T>): Promise<T> => {
        if (activation.closed) return Promise.reject(new Error(`The plugin ${id} is not active.`));
        return run();
      };
      // Each power within what the plugin declares: opening is network; reading and picturing the page, read;
      // clicking and typing in it, execute (review of phase 10).
      const within = <T>(effect: 'read' | 'execute', what: string, run: () => Promise<T>): Promise<T> =>
        declares.has(effect) ? live(run) : Promise.reject(new Error(`The plugin ${id} does not declare ${effect}: it cannot ${what}.`));
      // Whose agent calls: its conversation, and the project the core knows it in — never one the plugin names; the
      // conversation's own tab, in that project's session (the browser redo, step 2).
      const accessOf = async (conversationId: string): Promise<{ files: boolean; network: boolean; projectId?: string }> =>
        (await this.options.fileAccess?.(conversationId)) ?? { files: true, network: false };
      const callerOf = (conversationId: string, access: { projectId?: string }): BrowserCaller => ({
        conversationId,
        ...(access.projectId ? { projectId: access.projectId } : {}),
      });
      const caller = async (from: { conversationId: string }): Promise<BrowserCaller> => callerOf(from.conversationId, await accessOf(from.conversationId));
      context.browser = {
        open: (url, from) => live(async () => browser.open(url, await caller(from))),
        read: (from) => within('read', 'read the page', async () => browser.read(await caller(from))),
        screenshot: (from) => within('read', 'picture the page', async () => browser.screenshot(await caller(from))),
        act: (action, from) => within('execute', 'act in the page', async () => browser.act(action, await caller(from))),
        // A file is read: in the call's perimeter, checked here, never on the plugin's word (Paul, 2026-11-20).
        openFile: (path, from) =>
          within('read', 'open a file', async () => {
            const access = await accessOf(from.conversationId);
            if (!access.files) return { error: 'A discussion reaches no file: open a page of the internet with browser_open instead.' };
            const opened = await openPerimeterFile(browser, path, from.roots, access.network, callerOf(from.conversationId, access));
            return 'error' in opened || access.network ? opened : { ...opened, offline: true };
          }),
      };
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
        let verdict: Verdict;
        try {
          verdict = await judge({ conversationId: ctx.conversationId, tool: core.def, input });
        } catch (error) {
          return { content: `Not done: ${describe(error)}`, failed: true };
        }
        if (verdict.verdict === 'deny') return { content: `Not done: ${verdict.reason}`, failed: true };
        // The person allowed this very call of the plugin: what only the mode asks about is what they
        // allowed. Anything asked for another reason (a file that runs later, outside the perimeter, the
        // network) they never saw — refused.
        if (verdict.verdict === 'ask' && !(ctx.granted === true && verdict.why === 'mode')) {
          return {
            content: `Not done: ${inner} here needs the user's approval, which a plugin's tool cannot ask for. Do it with your own tools, so that the user is asked.`,
            failed: true,
          };
        }
        // The person allowed the plugin's call, not what it reaches: nothing lands outside the perimeter on its word.
        const inside: ToolContext = { ...ctx, granted: false };
        try {
          const output = await core.handler({ id: `${call.id}/${inner}`, name: inner, input }, inside);
          return { content: output.content, ...(output.failed ? { failed: true } : {}) };
        } catch (error) {
          return { content: `The tool failed: ${describe(error)}`, failed: true };
        }
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
      reset: () => {
        const flow = activation.flows.get(instanceId);
        if (!flow) return;
        flow.unacknowledged = 0;
        flow.paused = false;
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
    this.changed();
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
