/**
 * The window and the plugins (task 6.6): a command of a plugin's view to its
 * Node half, the view's acknowledgement of what it has shown (the host's
 * back-pressure), and the events the main process pushes to the window —
 * a plugin's for one of its views, and what a command of the agent prints.
 * The bridge pushes these on one channel, and nothing else.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';

const idSchema = z.string().min(1).max(128);

export const pluginsInvoke = defineChannel(
  'plugins.invoke',
  // The project of the conversation shown: a plugin it turned off answers nothing there (review of phase 6).
  z.object({ pluginId: idSchema, action: z.string().min(1).max(64), payload: z.unknown(), projectId: idSchema.optional() }),
  z.unknown(),
);

const localized = z.union([z.string(), z.object({ en: z.string(), fr: z.string().optional() })]);

/** A plugin as the window shows it (tasks 11.2 and 11.3). */
export const pluginStatusSchema = z.object({
  id: z.string(),
  name: localized,
  version: z.string(),
  description: localized.optional(),
  builtin: z.boolean(),
  effects: z.array(z.object({ effect: z.enum(['read', 'write', 'execute', 'network']), what: localized })),
  enabled: z.boolean(),
  active: z.boolean(),
  error: z.string().optional(),
  panes: z.array(z.object({ id: z.string(), title: localized, multiple: z.boolean(), shortcut: z.string().optional() })),
  tools: z.array(z.string()),
  source: z.unknown().optional(),
  update: z.string().optional(),
  /** A plugin of a third party's view, served in its own frame (task 11.2). */
  view: z.string().optional(),
  trial: z.string().optional(),
});

/** The plugins, and whether each is on for a project. */
export const pluginsOverview = defineChannel('plugins.overview', z.object({ projectId: idSchema.optional() }), z.array(pluginStatusSchema));

const statuses = z.array(pluginStatusSchema);

/** « Ajouter un plugin »: from a folder, from npm, from a git repository (task 11.3). */
export const pluginAddRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('folder'), path: z.string().min(1).max(1024) }),
  z.object({ kind: z.literal('npm'), spec: z.string().min(1).max(256) }),
  z.object({ kind: z.literal('git'), url: z.string().min(1).max(2048), ref: z.string().min(1).max(256) }),
]);
export type PluginAddRequestView = z.infer<typeof pluginAddRequestSchema>;

/** Its manifest read, nothing of it run: what the dialog shows before « Ajouter ». */
export const pluginsPreview = defineChannel(
  'plugins.preview',
  pluginAddRequestSchema,
  z.union([
    z.object({ ok: z.literal(true), preview: z.object({ stagingId: z.string(), manifest: z.record(z.string(), z.unknown()), source: z.unknown(), replaces: z.string().optional() }) }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]),
);
/** « Ajouter et activer » or « Ajouter sans activer ». */
export const pluginsInstall = defineChannel('plugins.install', z.object({ stagingId: z.string().uuid(), enable: z.boolean() }), statuses);
/** « Annuler »: what was read is let go. */
export const pluginsDiscard = defineChannel('plugins.discard', z.object({ stagingId: z.string().uuid() }), z.void());
/** A plugin switched on or off — for the app, or for one project. */
export const pluginsSetEnabled = defineChannel('plugins.setEnabled', z.object({ id: idSchema, enabled: z.boolean(), projectId: idSchema.optional() }), statuses);
export const pluginsRemove = defineChannel('plugins.remove', z.object({ id: idSchema }), statuses);
/** Where each came from asked for a newer version: proposed, never made. */
export const pluginsCheckUpdates = defineChannel('plugins.checkUpdates', z.void(), statuses);
/** The keys of the online search engines (task 11.3): kept or not — never a key handed back to the window. */
const keyedSearch = z.enum(['brave', 'tavily', 'serper']);
const keysKept = z.object({ brave: z.boolean(), tavily: z.boolean(), serper: z.boolean() });
export const searchKeysList = defineChannel('search.keys', z.void(), keysKept);
export const searchKeysSet = defineChannel('search.setKey', z.object({ provider: keyedSearch, key: z.string().max(512).nullable() }), keysKept);

/** « Parcourir… »: the system's folder dialog, in the main process. */
export const pluginsPickFolder = defineChannel('plugins.pickFolder', z.void(), z.object({ path: z.string().nullable() }));

export const pluginsAck = defineChannel(
  'plugins.ack',
  z.object({ pluginId: idSchema, instanceId: z.string().max(128), chars: z.number().int().min(0).max(10_000_000) }),
  z.void(),
);

/** The one channel the main process pushes on. */
export const APP_EVENT = 'bonaparte:event';

/** A command of the agent, told as it runs: the terminal's agent tab. */
export type CommandOutputView =
  | { kind: 'start'; command: string; cwd: string }
  | { kind: 'data'; text: string }
  | { kind: 'exit'; code: number | null };

export type AppEvent =
  | { kind: 'plugin'; pluginId: string; instanceId: string; event: string; payload: unknown }
  | { kind: 'command'; conversationId: string; output: CommandOutputView }
  /** The engine changed (started, ready, stopped, unloaded for want of work): the window reads it again. */
  | { kind: 'engine' }
  /** The plugins changed (one added, removed, switched on or off, stopped): the window reads them again (task 11.2). */
  | { kind: 'plugins' }
  /** The built-in browser changed (a tab, its address, its console, the agent reading): the pane reads it again (task 10.1). */
  | { kind: 'browser' }
  /** A notification or the notification area's menu was clicked: the window shows that conversation (task 8.5). */
  | { kind: 'open'; conversationId: string };
