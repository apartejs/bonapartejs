import { restoreDisarmed } from '../../families/control-tokens.js';
import { readFile, writeFile } from 'node:fs/promises';
import { displayInPerimeter } from '../../project/paths.js';
import { applyEdit, editFailure } from '../edit-text.js';
import { unifiedDiff } from '../preview.js';
import { describeError, inPerimeter, refused, text, type BuiltinTool } from './common.js';

const restoreOrKeep = (value: string | undefined): string | undefined => (value === undefined ? value : restoreDisarmed(value));

export const editFile: BuiltinTool = {
  def: {
    name: 'edit_file',
    description:
      'Replace one exact piece of text in a file. old_string must match the file exactly (indentation included) and occur only once: ' +
      'copy it from read_file, with a nearby line or two if needed to make it unique. Read the file first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The path of the file, relative to the project.' },
        old_string: { type: 'string', description: 'The exact text to replace, as read_file shows it: it must occur once in the file.' },
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
    // What the disarming added to the text the model read is not in the file (review of phase 13).
    const oldString = restoreOrKeep(text(call.input, 'old_string'));
    const newString = restoreOrKeep(text(call.input, 'new_string'));
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
    // Line endings aside (a CRLF file, an old_string written with LF): the file keeps its own (audit 2026-11-21, D4).
    const edit = applyEdit(content, oldString, newString);
    if (!edit.ok) return refused(editFailure(requested, edit));
    const shown = displayInPerimeter(ctx.roots, resolved.path);
    let after: string;
    try {
      await ctx.beforeWrite?.(resolved.path, shown);
      after = edit.after;
      await writeFile(resolved.path, after, 'utf8');
      await ctx.afterWrite?.(resolved.path);
    } catch (error) {
      return refused(`Cannot write file: ${requested} (${describeError(error)})`);
    }
    // The change, behind the window's line of the call.
    return { content: `Edited: ${shown}`, structuredContent: { diff: unifiedDiff(shown, content, after) } };
  },
};
