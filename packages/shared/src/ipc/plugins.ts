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
  z.object({ pluginId: idSchema, action: z.string().min(1).max(64), payload: z.unknown() }),
  z.unknown(),
);

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
  /** The built-in browser changed (a tab, its address, its console, the agent reading): the pane reads it again (task 10.1). */
  | { kind: 'browser' }
  /** A notification or the notification area's menu was clicked: the window shows that conversation (task 8.5). */
  | { kind: 'open'; conversationId: string };
