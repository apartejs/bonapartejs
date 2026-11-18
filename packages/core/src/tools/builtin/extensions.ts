/**
 * The tools that make a plugin in a conversation (task 11.4):
 *
 * - harness_inspect (read): the plugins, the tools and the plugin guide — what to read before making one;
 * - extension_define (write, in the app's data): a manifest and its code, compiled without being run, kept as a
 *   revision of its own; its card offers « Installer », « Essayer dans cette conversation », « Voir le code »;
 * - extension_run (execute): the newest revision runs in this conversation — its code shown in the approval;
 * - extension_stop and extension_undefine (interface): the trial ends; the plugin and its revisions go.
 *
 * Neither a discussion nor a sub-agent is given them. Everything said to the model is English.
 */

import type { PluginStatus } from '@aparte/bonaparte-shared';
import type { AddedPlugins } from '../../plugins/added.js';
import type { ExtensionStore } from '../../plugins/extensions.js';
import { PLUGIN_GUIDE } from '../../plugins/guide.js';
import type { ToolRegistry } from '../registry.js';
import { refused, text, type BuiltinTool } from './common.js';

export const EXTENSION_TOOLS = ['harness_inspect', 'extension_define', 'extension_run', 'extension_stop', 'extension_undefine'] as const;

export interface ExtensionToolsDeps {
  store: ExtensionStore;
  added: AddedPlugins;
  registry: ToolRegistry;
}

const english = (value: PluginStatus['name']): string => (typeof value === 'string' ? value : value.en);
const idInput = {
  type: 'object',
  properties: { id: { type: 'string', description: 'The id of the plugin, as in its manifest.' } },
  required: ['id'],
} as const;

export function extensionTools(deps: ExtensionToolsDeps): BuiltinTool[] {
  return [
    {
      def: {
        name: 'harness_inspect',
        description: 'See the plugins, the tools and the settings of bonaparte, and read the plugin guide: do it before you make a plugin.',
        inputSchema: { type: 'object', properties: {} },
        effect: 'read',
        source: 'builtin',
        where: 'core',
      },
      handler: async () => {
        const plugins = deps.added.host.status().map(
          (plugin) =>
            `- ${plugin.id} (${english(plugin.name)} ${plugin.version}): ${plugin.enabled ? 'on' : 'off'}${plugin.trial ? ', on trial' : ''}; effects ${plugin.effects.map((one) => one.effect).join(', ') || 'none'}; tools ${plugin.tools.join(', ') || 'none'}`,
        );
        const tools = deps.registry.list().map((tool) => `- ${tool.name} (${tool.effect}, ${tool.source})`);
        return { content: ['Plugins:', ...plugins, '', 'Tools:', ...tools, '', PLUGIN_GUIDE].join('\n') };
      },
    },
    {
      def: {
        name: 'extension_define',
        description:
          'Define a plugin made in this conversation: its manifest (plugin.json) and the code of its Node half (an ES module). The code is compiled, never run; each call keeps a new revision.',
        inputSchema: {
          type: 'object',
          properties: {
            manifest: { type: 'object', description: 'The manifest: id, name, version, effects, contributes (see the plugin guide).' },
            code: { type: 'string', description: 'The ES module whose default export has activate(ctx).' },
          },
          required: ['manifest', 'code'],
        },
        effect: 'write',
        source: 'builtin',
        where: 'core',
      },
      handler: async (call, ctx) => {
        const input = call.input as { manifest?: unknown; code?: unknown };
        if (typeof input?.code !== 'string' || input.code.trim() === '') return refused('Give the code of the Node half in "code".');
        const defined = await deps.store.define(ctx.conversationId, { manifest: input.manifest, code: input.code });
        if (!defined.ok) return refused(defined.error);
        const { extension } = defined;
        return {
          content: `Defined ${extension.id} ${extension.manifest.version}, revision ${extension.rev} (${extension.lines} lines), compiled. Nothing runs yet: run it with extension_run, or the person installs or tries it from its card.`,
          structuredContent: {
            extension: {
              conversationId: extension.conversationId,
              id: extension.id,
              rev: extension.rev,
              lines: extension.lines,
              manifest: extension.manifest,
            },
          },
        };
      },
    },
    {
      def: {
        name: 'extension_run',
        description: 'Run the newest revision of a plugin made in this conversation, here only. The person sees its code and says yes first.',
        inputSchema: idInput,
        effect: 'execute',
        source: 'builtin',
        where: 'core',
      },
      handler: async (call, ctx) => {
        const id = text(call.input, 'id') ?? '';
        const extension = deps.store.get(ctx.conversationId, id);
        if (!extension) return refused(`No plugin ${id} was defined in this conversation: define it with extension_define first.`);
        try {
          const status = await deps.added.tryExtension(extension);
          if (!status.active) return refused(`The plugin ${id} did not start: ${status.error ?? 'no reason given'}. Fix it and define it again.`);
          const commands = extension.manifest.contributes.commands.map((command) => `/${command.name}`);
          return {
            content: `The plugin ${id} (revision ${extension.rev}) runs in this conversation. Its tools (${status.tools.join(', ') || 'none'}) and commands (${commands.join(', ') || 'none'}) reach you from the next message.`,
          };
        } catch (error) {
          return refused(error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      def: {
        name: 'extension_stop',
        description: 'End the trial of a plugin made in this conversation: all it added goes.',
        inputSchema: idInput,
        effect: 'ui',
        source: 'builtin',
        where: 'core',
      },
      handler: async (call, ctx) => {
        const id = text(call.input, 'id') ?? '';
        await deps.added.stopTrial(id, ctx.conversationId);
        return { content: `The trial of ${id} ended.` };
      },
    },
    {
      def: {
        name: 'extension_undefine',
        description: 'Remove a plugin made in this conversation, every revision of it; its trial ends.',
        inputSchema: idInput,
        effect: 'ui',
        source: 'builtin',
        where: 'core',
      },
      handler: async (call, ctx) => {
        const id = text(call.input, 'id') ?? '';
        await deps.added.stopTrial(id, ctx.conversationId);
        await deps.store.undefine(ctx.conversationId, id);
        return { content: `${id} was removed from this conversation.` };
      },
    },
  ];
}
