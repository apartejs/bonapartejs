/**
 * @aparte/bonaparte-plugin-sdk — what a plugin author imports.
 *
 * Everything a plugin does goes through the context its host gives it, and
 * the host tears that context down as one: a plugin keeps no list of what to
 * undo. Its manifest says, before anything of it runs, what it will be able
 * to do (its effects); a tool never does more than its plugin says, and it
 * reaches the machine only through the core's own tools (`use`), judged by
 * the same policy as the model's calls.
 *
 * The two helpers below only type what the author writes: the host reads the
 * manifest again (`parseManifest`) and holds the plugin to it whatever they
 * say.
 */

import type { PluginManifestInput, PluginNodeModule } from '@aparte/bonaparte-shared';

export { localize, parseManifest, PLUGIN_EFFECTS, usableEffects } from '@aparte/bonaparte-shared';
export type {
  LocalizedText,
  PluginCommandHandler,
  PluginEffect,
  PluginInstanceChannel,
  PluginManifest,
  PluginManifestInput,
  PluginNodeContext,
  PluginNodeModule,
  PluginPaneContribution,
  PluginProcess,
  PluginSettingField,
  PluginSignal,
  PluginStatus,
  PluginToolContribution,
  PluginToolHandler,
  PluginToolInvocation,
  PluginToolResult,
  PluginToolUse,
} from '@aparte/bonaparte-shared';

/** The Node half of a plugin: its `activate`, given its context. */
export function definePlugin<T extends PluginNodeModule>(plugin: T): T {
  return plugin;
}

/** A manifest, typed as its author writes it. */
export function defineManifest<T extends PluginManifestInput>(manifest: T): T {
  return manifest;
}
