import { readFile } from 'node:fs/promises';
import { lineCount } from '../preview.js';
import { describeError, inPerimeter, refused, text, wholeNumber, type BuiltinTool } from './common.js';

export const readFileTool: BuiltinTool = {
  def: {
    name: 'read_file',
    description: 'Read a text file of the project. Optionally a slice of its lines: offset (the first line, from 1) and limit.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The path of the file, relative to the project.' },
        offset: { type: 'number', description: 'The first line to read, from 1.' },
        limit: { type: 'number', description: 'How many lines to read.' },
      },
      required: ['path'],
    },
    effect: 'read',
    source: 'builtin',
    where: 'core',
  },
  handler: async (call, ctx) => {
    const requested = text(call.input, 'path');
    if (!requested) return refused('Missing argument: path.');
    const resolved = inPerimeter(ctx, requested);
    if ('error' in resolved) return refused(resolved.error);
    let content: string;
    try {
      content = await readFile(resolved.path, 'utf8');
    } catch (error) {
      return refused(`Cannot read file: ${requested} (${describeError(error)})`);
    }
    const offset = wholeNumber(call.input, 'offset');
    const limit = wholeNumber(call.input, 'limit');
    if (offset !== undefined || limit !== undefined) {
      const lines = content.split('\n');
      const start = Math.max(0, (offset ?? 1) - 1);
      content = lines.slice(start, limit !== undefined ? start + Math.max(0, limit) : lines.length).join('\n');
    }
    // For the window's line: « Lu a.ts · 3 lignes ».
    return { content, structuredContent: { lines: lineCount(content) } };
  },
};
