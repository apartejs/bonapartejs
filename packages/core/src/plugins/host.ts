/**
 * Plugin host — discovery, validation, REVERSIBLE activation.
 *
 * Two principles, and the second is the only one that matters long-term:
 *
 * 1. The manifest is **declarative**: it's read and validated without
 *    executing a single line of the plugin. A duplicate id, a malformed
 *    view, a tool with no description are caught BEFORE anything gets
 *    loaded.
 *
 * 2. Everything a plugin registers goes through its **context**, and the
 *    context undoes everything on teardown. A plugin author has no list of
 *    unregistrations to maintain — so nothing to forget. That's what makes
 *    a deactivation (or a hot swap) safe, rather than dependent on
 *    everyone's discipline.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  pluginManifestSchema,
  type PluginManifest,
  type PluginStatusDto,
} from '@aparte/bonaparte-shared';
import type { ToolDef, ToolHandler } from '../tools/types.js';
import type { ToolRegistry } from '../tools/registry.js';

export const PLUGIN_MANIFEST_FILE = 'plugin.json';

/** Result of a plugin tool, as the model will receive it. */
export interface PluginToolResult {
  ok: boolean;
  content: string;
}

export interface PluginToolInvocation {
  args: Record<string, unknown>;
  projectRoot?: string;
  signal: AbortSignal;
}

export type PluginToolHandler = (
  invocation: PluginToolInvocation,
) => Promise<PluginToolResult>;

/** Command callable from the plugin's view (renderer → main). */
export type PluginCommandHandler = (payload: unknown) => Promise<unknown> | unknown;

/**
 * Channel to ONE view instance — one tab of the tooling panel.
 *
 * Since the panel allows opening several tabs of the same type (two
 * terminals, three browsers), backpressure must be counted per instance:
 * with a single counter per plugin, a `cat` of a large file in one
 * terminal would freeze the neighboring terminal.
 */
export interface PluginInstanceChannel {
  /** Pushes to THIS instance. `false` = it's falling behind, stop. */
  emit(event: string, payload: unknown): boolean;
  /** This instance has caught up. */
  onDrain(listener: () => void): void;
  /** The tab is closed: we forget its counter and stop emitting. */
  dispose(): void;
}

export interface PluginNodeContext {
  readonly pluginId: string;
  registerToolHandler(name: string, handler: PluginToolHandler): void;
  /**
   * Exposes a command to the plugin's VIEW. This is the only renderer →
   * Node-half path: it goes through the host, so it gets torn down with
   * the plugin and cannot survive its deactivation.
   */
  registerCommand(name: string, handler: PluginCommandHandler): void;
  getConfig<T = unknown>(key: string): T | undefined;
  /**
   * Pushes an event to the plugin's VIEW. Returns `false` when the view is
   * falling behind: the caller must stop reading its source until
   * `onDrain`. Node stream convention — `write()` then `'drain'`.
   */
  emit(event: string, payload: unknown): boolean;
  /** The view has caught up: the producer can resume. */
  onDrain(listener: () => void): void;
  /**
   * Channel to a specific view instance. A plugin managing several tabs
   * opens one per session and keeps it alongside it.
   */
  channel(instanceId: string): PluginInstanceChannel;
  onDispose(dispose: () => void | Promise<void>): void;
  log(message: string): void;
}

export interface PluginNodeModule {
  activate(context: PluginNodeContext): void | Promise<void>;
}

export interface DiscoveredPlugin {
  id: string;
  /** Plugin's folder — used to resolve its entry points. */
  dir: string;
  manifest?: PluginManifest;
  error?: string;
  active: boolean;
}

export interface PluginHostOptions {
  registry: ToolRegistry;
  /** Global plugin settings, by id then by key. */
  config?: Record<string, Record<string, unknown>>;
  logger?: (message: string) => void;
  /**
   * Routes an event pushed by a plugin to ITS view. `core` doesn't know
   * about Electron: it's the application host that provides the
   * transport.
   */
  emit?: (
    pluginId: string,
    instanceId: string,
    event: string,
    payload: unknown,
  ) => void;
}

/**
 * Backpressure thresholds, taken AS-IS from VS Code
 * (`FlowControlConstants`, src/vs/platform/terminal/common/terminal.ts).
 *
 * The problem is the same as theirs: a native producer — a PTY — outputs
 * faster than the view consumes. Growing the buffer only delays the loss;
 * the only correct answer is to PAUSE THE PRODUCER.
 *
 * `ackSize` must stay <= `lowWatermark`, otherwise the client would never
 * reach the threshold that triggers the resume and the producer would
 * stay stuck.
 */
export const FLOW_CONTROL = {
  /** Unacknowledged bytes beyond which the producer must stop. */
  highWatermark: 100_000,
  /** Unacknowledged bytes below which it can resume. */
  lowWatermark: 5_000,
  /** Size of the acknowledgment batch on the view side. */
  ackSize: 5_000,
} as const;

/**
 * Weight of a payload, in characters.
 *
 * Terminal data is strings: we measure them directly. For everything
 * else, JSON serialization gives a good-enough order of magnitude — this
 * is about regulating a flow rate, not billing exact bytes.
 */
function sizeOf(payload: unknown): number {
  if (typeof payload === 'string') return payload.length;
  try {
    return JSON.stringify(payload)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Everything an activation has set up, so it can be torn down as one block. */
interface ActivationRecord {
  toolNames: string[];
  commands: Map<string, PluginCommandHandler>;
  disposers: (() => void | Promise<void>)[];
  /** One flow per view instance, plus a default channel (empty key). */
  flows: Map<string, InstanceFlow>;
}

/** Backpressure counter for ONE instance. */
interface InstanceFlow {
  unacknowledged: number;
  paused: boolean;
  drainListeners: (() => void)[];
}

export class PluginHost {
  private readonly plugins = new Map<string, DiscoveredPlugin>();
  private readonly activations = new Map<string, ActivationRecord>();

  /** Plugins the user switched off (P3.2): discovered, listed, never activated. */
  private readonly disabled = new Set<string>();

  constructor(private readonly options: PluginHostOptions) {}

  /** Switches a plugin on or off. Off takes effect at the next activation — deactivate it to stop it now. */
  setEnabled(id: string, enabled: boolean): void {
    if (enabled) this.disabled.delete(id);
    else this.disabled.add(id);
  }

  isEnabled(id: string): boolean {
    return !this.disabled.has(id);
  }

  /**
   * Scans a plugins folder. Every subfolder containing a `plugin.json` is
   * a candidate; an unreadable or invalid manifest is KEPT along with its
   * error, so the Settings hub can show it instead of silently making it
   * disappear.
   */
  async discover(root: string): Promise<DiscoveredPlugin[]> {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      return [];
    }

    const found: DiscoveredPlugin[] = [];
    for (const entry of entries.sort()) {
      const dir = join(root, entry);
      let raw: string;
      try {
        raw = await readFile(join(dir, PLUGIN_MANIFEST_FILE), 'utf8');
      } catch {
        continue; // not a plugin: no noise, no error
      }

      const parsed = this.parseManifest(raw);
      if ('error' in parsed) {
        found.push({ id: entry, dir, error: parsed.error, active: false });
        continue;
      }

      const manifest = parsed.manifest;
      const claimed = this.plugins.get(manifest.id);
      if (claimed && claimed.dir !== dir) {
        found.push({
          id: manifest.id,
          dir,
          error: `identifier already taken by ${claimed.dir}`,
          active: false,
        });
        continue;
      }

      const plugin: DiscoveredPlugin = { id: manifest.id, dir, manifest, active: false };
      this.plugins.set(manifest.id, plugin);
      found.push(plugin);
    }
    return found;
  }

  private parseManifest(raw: string): { manifest: PluginManifest } | { error: string } {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { error: 'unreadable manifest (invalid JSON)' };
    }
    const result = pluginManifestSchema.safeParse(json);
    if (!result.success) {
      const first = result.error.issues[0];
      return {
        error: first ? `${first.path.join('.') || 'manifest'}: ${first.message}` : 'invalid manifest',
      };
    }
    return { manifest: result.data };
  }

  /** Discovered plugin (useful for resolving the entry point to import). */
  get(id: string): DiscoveredPlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Activates an already-discovered plugin. The module is supplied by the
   * caller: IT decides how to load code (import() on the main side, a
   * custom protocol on the renderer side) — the host itself stays
   * testable without loading anything.
   */
  async activate(id: string, module: PluginNodeModule): Promise<void> {
    // Switched off by the user: nothing of it runs.
    if (this.disabled.has(id)) return;
    const plugin = this.plugins.get(id);
    if (!plugin?.manifest) throw new Error(`Unknown plugin: ${id}`);
    if (this.activations.has(id)) return;

    const manifest = plugin.manifest;
    const declared = new Map(manifest.contributes.agentTools.map((t) => [t.name, t]));
    const record: ActivationRecord = {
      toolNames: [],
      commands: new Map(),
      disposers: [],
      flows: new Map(),
    };

    const context: PluginNodeContext = {
      pluginId: id,
      registerToolHandler: (name, handler) => {
        const contribution = declared.get(name);
        if (!contribution) {
          throw new Error(
            `Tool not declared in the manifest of "${id}": ${name}. ` +
              'The manifest must remain readable without executing the plugin.',
          );
        }
        const def: ToolDef = {
          name,
          description: contribution.description,
          inputSchema: contribution.inputSchema ?? { type: 'object', properties: {} },
          effect: contribution.effect,
        };
        this.options.registry.register(def, this.adapt(handler), 'plugin');
        record.toolNames.push(name);
      },
      registerCommand: (name, handler) => {
        record.commands.set(name, handler);
      },
      getConfig: <T,>(key: string) =>
        this.options.config?.[id]?.[key] as T | undefined,
      onDispose: (dispose) => record.disposers.push(dispose),
      log: (message) => this.options.logger?.(`[plugin:${id}] ${message}`),

      /**
       * Pushes an event to the view. Returns `false` when the view is
       * falling behind: the caller MUST then stop reading its source
       * until `onDrain`. This is the Node stream convention (`write` then
       * `drain`), chosen because everyone already knows it.
       *
       * With no targeted instance: the default channel, for a
       * single-view plugin.
       */
      emit: (event, payload) => defaultChannel().emit(event, payload),
      onDrain: (listener) => defaultChannel().onDrain(listener),
      channel: (instanceId) => this.channelFor(id, record, instanceId),
    };

    const defaultChannel = (): PluginInstanceChannel =>
      this.channelFor(id, record, '');

    this.activations.set(id, record);
    try {
      await module.activate(context);
    } catch (error) {
      // Failed activation = nothing remains. A half-mounted plugin is
      // worse than an absent plugin: the inventory would lie to the model.
      await this.deactivate(id);
      plugin.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
    plugin.active = true;
    delete plugin.error;
  }

  /** Tears down a plugin: tools removed, cleanups run, in order. */
  async deactivate(id: string): Promise<void> {
    const record = this.activations.get(id);
    if (!record) return;
    this.activations.delete(id);

    for (const name of record.toolNames) this.options.registry.unregister(name);
    // Cleanups run in reverse registration order (a stack), and one that
    // fails must not prevent the following ones.
    for (const dispose of [...record.disposers].reverse()) {
      try {
        await dispose();
      } catch (error) {
        this.options.logger?.(
          `[plugin:${id}] cleanup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const plugin = this.plugins.get(id);
    if (plugin) plugin.active = false;
  }

  /** Calls a command exposed by an active plugin. */
  async invoke(pluginId: string, command: string, payload: unknown): Promise<unknown> {
    const handler = this.activations.get(pluginId)?.commands.get(command);
    if (!handler) {
      throw new Error(`Unknown command: ${pluginId}.${command}`);
    }
    return handler(payload);
  }

  /** Tears down everything — called when the app closes. */
  /**
   * Channel to an instance. The counter is created on demand and lives in
   * the activation, so it disappears with the plugin.
   */
  private channelFor(
    pluginId: string,
    record: ActivationRecord,
    instanceId: string,
  ): PluginInstanceChannel {
    // `disposed` belongs to the CHANNEL, not the counter: reopening a tab
    // with the same id must yield a fresh, free channel, while the old
    // object, if it still lingers in some closure, must stay silent.
    let disposed = false;

    const ensure = (): InstanceFlow => {
      const existing = record.flows.get(instanceId);
      if (existing) return existing;
      const created: InstanceFlow = {
        unacknowledged: 0,
        paused: false,
        drainListeners: [],
      };
      record.flows.set(instanceId, created);
      return created;
    };

    return {
      emit: (event, payload) => {
        // Plugin torn down, or channel discarded: a dead view receives nothing.
        if (disposed || this.activations.get(pluginId) !== record) return false;
        const flow = ensure();
        this.options.emit?.(pluginId, instanceId, event, payload);
        flow.unacknowledged += sizeOf(payload);
        if (flow.unacknowledged >= FLOW_CONTROL.highWatermark) flow.paused = true;
        return !flow.paused;
      },
      onDrain: (listener) => {
        if (disposed) return;
        ensure().drainListeners.push(listener);
      },
      dispose: () => {
        disposed = true;
        record.flows.delete(instanceId);
      },
    };
  }

  /**
   * The view signals that it has CONSUMED `bytes` bytes for an instance.
   *
   * THIS instance's count goes back down; crossing back below the low
   * watermark wakes it up — other tabs are untouched. An unknown plugin
   * or instance is ignored: a late acknowledgment, after a tab closes,
   * must not throw.
   */
  acknowledge(pluginId: string, instanceId: string, bytes: number): void {
    const flow = this.activations.get(pluginId)?.flows.get(instanceId);
    if (!flow || bytes <= 0) return;
    flow.unacknowledged = Math.max(0, flow.unacknowledged - bytes);
    if (flow.paused && flow.unacknowledged < FLOW_CONTROL.lowWatermark) {
      flow.paused = false;
      for (const listener of flow.drainListeners) listener();
    }
  }

  async deactivateAll(): Promise<void> {
    for (const id of [...this.activations.keys()]) await this.deactivate(id);
  }

  /** Snapshot for the UI (Settings hub, tooling panel tabs). */
  status(): PluginStatusDto[] {
    return [...this.plugins.values()].map((plugin) => ({
      id: plugin.id,
      name: plugin.manifest?.name ?? plugin.id,
      version: plugin.manifest?.version ?? '—',
      ...(plugin.manifest?.description ? { description: plugin.manifest.description } : {}),
      enabled: !this.disabled.has(plugin.id),
      active: plugin.active,
      ...(plugin.error ? { error: plugin.error } : {}),
      views: plugin.active ? (plugin.manifest?.contributes.toolingViews ?? []) : [],
      toolNames: this.activations.get(plugin.id)?.toolNames ?? [],
      configSchemas: plugin.active ? (plugin.manifest?.contributes.configSchemas ?? []) : [],
    }));
  }

  /** Adapts the plugin SDK's signature to that of the harness's tool registry. */
  private adapt(handler: PluginToolHandler): ToolHandler {
    return async (args, context) =>
      handler({
        args,
        // The plugin SDK only knows one root: we give it the first one,
        // the one relative paths resolve against. Widening its contract
        // to N roots is an SDK change, hence a change for every plugin —
        // deferred, and logged.
        ...(context.roots[0] ? { projectRoot: context.roots[0] } : {}),
        signal: context.signal,
      });
  }
}
