import { readFile, writeFile } from 'node:fs/promises';
import { displayInPerimeter } from '../../project/paths.js';
import { unifiedDiff } from '../preview.js';
import { describeError, inPerimeter, refused, text, type BuiltinTool } from './common.js';

export const editFile: BuiltinTool = {
  def: {
    name: 'edit_file',
    description:
      'Replace the one place old_string stands in a file with new_string. Give enough of the text around it for it to stand only once.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The path of the file, relative to the project.' },
        old_string: { type: 'string', description: 'The exact text to replace: it must stand once in the file.' },
        new_string: { type: 'string', description: 'The text to put in its place.' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    effect: 'write',
    source: 'builtin',
    where: 'core',
  },
  handler: async (call, ctx) => {
    const requested = text(call.input, 'path');
    const oldString = text(call.input, 'old_string');
    const newString = text(call.input, 'new_string');
    if (!requested) return refused('Missing argument: path.');
    if (oldString === undefined || newString === undefined) return refused('The arguments old_string and new_string are required.');
    if (oldString === '') return refused('old_string is empty: give the text to replace.');
    const resolved = inPerimeter(ctx, requested);
    if ('error' in resolved) return refused(resolved.error);
    let content: string;
    try {
      content = await readFile(resolved.path, 'utf8');
    } catch (error) {
      return refused(`Cannot read file: ${requested} (${describeError(error)})`);
    }
    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) return refused(`The text was not found in ${requested}: no occurrence of old_string. The file is unchanged.`);
    if (occurrences > 1) {
      return refused(`The text stands ${occurrences} times in ${requested} (${occurrences} occurrences): widen old_string so that it stands once. The file is unchanged.`);
    }
    const shown = displayInPerimeter(ctx.roots, resolved.path);
    let after: string;
    try {
      await ctx.beforeWrite?.(resolved.path, shown);
      // A function: `$&` or `$1` in the new text are written as they are.
      after = content.replace(oldString, () => newString);
      await writeFile(resolved.path, after, 'utf8');
      await ctx.afterWrite?.(resolved.path);
    } catch (error) {
      return refused(`Cannot write file: ${requested} (${describeError(error)})`);
    }
    // The change, behind the window's line of the call.
    return { content: `Edited: ${shown}`, structuredContent: { diff: unifiedDiff(shown, content, after) } };
  },
};
