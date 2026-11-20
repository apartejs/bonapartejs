import { restoreDisarmed } from '../../families/control-tokens.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { displayInPerimeter } from '../../project/paths.js';
import { keepEndings } from '../edit-text.js';
import { unifiedDiff } from '../preview.js';
import { describeError, inPerimeter, refused, text, type BuiltinTool } from './common.js';

const restoreOrKeep = (value: string | undefined): string | undefined => (value === undefined ? value : restoreDisarmed(value));

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
    const given = restoreOrKeep(text(call.input, 'content'));
    if (!requested) return refused('Missing argument: path.');
    if (given === undefined) return refused('Missing argument: content (a string).');
    const resolved = inPerimeter(ctx, requested);
    if ('error' in resolved) return refused(resolved.error);
    const shown = displayInPerimeter(ctx.roots, resolved.path);
    // What it replaces, for the change the window shows: nothing when the file is new.
    const before = await readFile(resolved.path, 'utf8').catch(() => null);
    // A CRLF file keeps its endings (audit 2026-11-21, D4).
    const content = keepEndings(before, given);
    try {
      await ctx.beforeWrite?.(resolved.path, shown);
      await mkdir(dirname(resolved.path), { recursive: true });
      await writeFile(resolved.path, content, 'utf8');
      await ctx.afterWrite?.(resolved.path);
    } catch (error) {
      return refused(`Cannot write file: ${requested} (${describeError(error)})`);
    }
    return {
      content: `Wrote: ${shown} (${content.length} characters)`,
      structuredContent: { created: before === null, diff: unifiedDiff(shown, before, content) },
    };
  },
};
