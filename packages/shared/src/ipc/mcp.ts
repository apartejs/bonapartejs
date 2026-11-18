/**
 * The MCP servers through the bridge (task 10.5): the page lists them — their scope, their command or address,
 * their state and their tools — and starts, stops, removes, pastes or adds one. A server's headers (a token)
 * never cross the bridge; the window never connects to a server.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';

const serverId = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);

export const mcpServerViewSchema = z.object({
  id: z.string(),
  scope: z.discriminatedUnion('kind', [z.object({ kind: z.literal('app') }), z.object({ kind: z.literal('project'), projectId: z.string() })]),
  transport: z.enum(['stdio', 'http']),
  target: z.string(),
  state: z.enum(['stopped', 'off', 'connecting', 'connected', 'failed']),
  error: z.string().optional(),
  tools: z.array(z.object({ name: z.string(), readOnly: z.boolean() })),
});

export type McpServerViewData = z.infer<typeof mcpServerViewSchema>;

const servers = z.array(mcpServerViewSchema);

export const mcpOverview = defineChannel('mcp.overview', z.void(), servers);
/** « Démarrer », « Redémarrer », « Reconnecter »: the server (re)started; the list as it stands then. */
export const mcpStart = defineChannel('mcp.start', z.object({ id: serverId }), servers);
export const mcpStop = defineChannel('mcp.stop', z.object({ id: serverId }), servers);
export const mcpRemove = defineChannel('mcp.remove', z.object({ id: serverId }), servers);

/** « Coller une configuration »: the servers added, and what did not read. */
export const mcpPaste = defineChannel(
  'mcp.paste',
  z.object({ text: z.string().max(200_000) }),
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), added: z.array(z.string()), errors: z.array(z.object({ id: z.string(), code: z.string() })) }),
    z.object({ ok: z.literal(false), error: z.literal('unreadable') }),
  ]),
);

/** « Ajouter un serveur »: a name, an address or a command line, the app or one project. */
export const mcpAdd = defineChannel(
  'mcp.add',
  z.object({ name: z.string().max(64), target: z.string().max(4096), projectId: z.string().max(128).optional() }),
  z.discriminatedUnion('ok', [z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), error: z.enum(['name', 'target', 'unreadable']) })]),
);
