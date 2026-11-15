import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { displayInPerimeter } from '../../project/paths.js';
import { describeError, inPerimeter, refused, text, type BuiltinTool } from './common.js';

export const writeFileTool: BuiltinTool = {
  def: {
    name: 'write_file',
    description: 'Write a whole file of the project: it is created, with its folders, or replaced.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The path of the file, relative to the project.' },
        content: { type: 'string', description: 'The whole new content of the file.' },
      },
      required: ['path', 'content'],
    },
    effect: 'write',
    source: 'builtin',
    where: 'core',
  },
  handler: async (call, ctx) => {
    const requested = text(call.input, 'path');
    const content = text(call.input, 'content');
    if (!requested) return refused('Missing argument: path.');
    if (content === undefined) return refused('Missing argument: content (a string).');
    const resolved = inPerimeter(ctx, requested);
    if ('error' in resolved) return refused(resolved.error);
    const shown = displayInPerimeter(ctx.roots, resolved.path);
    try {
      await ctx.beforeWrite?.(resolved.path, shown);
      await mkdir(dirname(resolved.path), { recursive: true });
      await writeFile(resolved.path, content, 'utf8');
      await ctx.afterWrite?.(resolved.path);
    } catch (error) {
      return refused(`Cannot write file: ${requested} (${describeError(error)})`);
    }
    return { content: `Wrote: ${shown} (${content.length} characters)` };
  },
};
