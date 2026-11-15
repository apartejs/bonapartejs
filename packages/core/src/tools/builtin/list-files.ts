import { readdir } from 'node:fs/promises';
import { describeError, inPerimeter, refused, text, type BuiltinTool } from './common.js';

export const listFiles: BuiltinTool = {
  def: {
    name: 'list_files',
    description: 'List what a folder of the project holds (its root by default); folders end with a slash.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'The folder, relative to the project.' } },
    },
    effect: 'read',
    source: 'builtin',
    where: 'core',
  },
  handler: async (call, ctx) => {
    const requested = text(call.input, 'path') ?? '.';
    const resolved = inPerimeter(ctx, requested);
    if ('error' in resolved) return refused(resolved.error);
    try {
      const entries = await readdir(resolved.path, { withFileTypes: true });
      if (entries.length === 0) return { content: '(empty folder)' };
      const names = entries.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name)).sort((a, b) => a.localeCompare(b));
      return { content: names.join('\n') };
    } catch (error) {
      return refused(`Cannot read folder: ${requested} (${describeError(error)})`);
    }
  },
};
