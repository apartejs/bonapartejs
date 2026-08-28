/**
 * @aparte/bonaparte-plugin-sdk — what a plugin author consumes.
 *
 * Guiding principle, borrowed from plugin kernels that hold up over time:
 * **everything a plugin registers goes through its context, and the context
 * undoes all of it on deactivation**. An author keeps no list of
 * unregistrations to maintain — so nothing to forget. That's the condition
 * for a view (or even a tool) to be replaceable without restarting the app.
 */

import type { BonaparteBridge } from '@aparte/bonaparte-shared';

/**
 * The bridge exposed by the preload. Declaring it here saves every plugin
 * from redeclaring the global — and guarantees they all speak the SAME contract.
 */
declare global {
  interface Window {
    bonaparte: BonaparteBridge;
  }
}

export type {
  AgentToolContribution,
  PluginConfigField,
  PluginManifest,
  PluginStatusDto,
  ToolingViewContribution,
} from '@aparte/bonaparte-shared';

/** A tool's result, as the model will receive it. */
export interface PluginToolResult {
  ok: boolean;
  content: string;
}

export interface PluginToolInvocation {
  args: Record<string, unknown>;
  /** Root of the open project — absent if the conversation has none. */
  projectRoot?: string;
  signal: AbortSignal;
}

export type PluginToolHandler = (
  invocation: PluginToolInvocation,
) => Promise<PluginToolResult>;

/** Command callable from the plugin's view. */
export type PluginCommandHandler = (payload: unknown) => Promise<unknown> | unknown;

/**
 * Node context of an active plugin (main process). Every registration is
 * reversible: the host undoes all of it on `deactivate`.
 */
export interface PluginNodeContext {
  readonly pluginId: string;
  /**
   * Wires the handler for a tool DECLARED in the manifest. A tool that isn't
   * declared is refused: the manifest stays the source of truth, readable
   * without executing the plugin.
   */
  registerToolHandler(name: string, handler: PluginToolHandler): void;
  /**
   * Exposes a command to the plugin's VIEW. It's the only renderer →
   * Node-half path: it goes through the host, so it unmounts with the plugin.
   */
  registerCommand(name: string, handler: PluginCommandHandler): void;
  /** Value of a plugin setting (global scope). */
  getConfig<T = unknown>(key: string): T | undefined;
  /**
   * Pushes an event to the plugin's VIEW, without it having to poll.
   *
   * Returns `false` when the view is BEHIND: the caller must then stop
   * reading its source (pausing its PTY, for instance) until `onDrain`
   * fires. Same convention as Node streams — `write()` then `'drain'` —
   * since it's already familiar.
   *
   * Without this back-pressure, a fast producer loses data: that's the
   * lesson VS Code learned for its terminal.
   */
  emit(event: string, payload: unknown): boolean;
  /** The view has caught up: the producer may resume. */
  onDrain(listener: () => void): void;
  /**
   * Channel to ONE view instance — a tab in the panel.
   *
   * The panel allows opening several tabs of the same type: two terminals,
   * three browsers. Back-pressure is therefore counted per instance,
   * otherwise one overflowing tab would freeze its neighbors. A
   * multi-instance plugin opens one channel per session and keeps it
   * alongside it.
   */
  channel(instanceId: string): PluginInstanceChannel;
  /** Extra cleanup to run on unmount. */
  onDispose(dispose: () => void | Promise<void>): void;
  /** Logs, prefixed with the plugin's id. */
  log(message: string): void;
}

/** Node entry point of a plugin: `export default definePlugin({...})`. */
/** Channel to a view instance. Same contract as `emit`/`onDrain`, targeted. */
export interface PluginInstanceChannel {
  emit(event: string, payload: unknown): boolean;
  onDrain(listener: () => void): void;
  /** The tab is closed: the counter is forgotten and the channel goes silent. */
  dispose(): void;
}

export interface PluginNodeModule {
  activate(context: PluginNodeContext): void | Promise<void>;
}

export function definePlugin(plugin: PluginNodeModule): PluginNodeModule {
  return plugin;
}

/**
 * What a view receives from the tooling panel. The panel only provides the
 * tab and the space: the view is sovereign over its content.
 */
export interface ToolingViewProps {
  /** Project of the open conversation — absent if it has none. */
  projectRoot: string | null;
  /** Open conversation, for views that attach to it. */
  conversationId: string | null;
  /**
   * Identity of THIS tab.
   *
   * Since the panel allows opening several tabs of the same type, the view
   * can no longer assume it's alone: it passes this identifier with every
   * command, and only keeps the events that carry it.
   */
  instanceId: string;
  locale: 'fr' | 'en';
  /**
   * What this tab was opened with by another view — a URL to show, a script
   * whose page to follow. Absent for a tab opened from the menu.
   */
  init?: Record<string, unknown>;
  /**
   * Asks the panel to open another view — the browser on a URL, say. False
   * when no active plugin offers it: the caller then falls back on its own.
   */
  openView?: (pluginId: string, viewId: string, init?: Record<string, unknown>) => boolean;
}
