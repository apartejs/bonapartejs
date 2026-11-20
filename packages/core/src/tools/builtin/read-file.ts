import { readFile } from 'node:fs/promises';
import { maxToolOutputChars } from '../output-cap.js';
import { lineCount } from '../preview.js';

/** Room kept for the note that says which lines were shown. */
const NOTE_ROOM = 100;
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
    const lines = content.split('\n');
    const start = Math.max(0, (offset ?? 1) - 1);
    if (offset !== undefined || limit !== undefined) {
      content = lines.slice(start, limit !== undefined ? start + Math.max(0, limit) : lines.length).join('\n');
    }
    // Too long for the context: whole lines up to the cap, and where to go on (audit 2026-11-21, D5) — never the
    // registry's cut in the middle of a file.
    const max = maxToolOutputChars(ctx.nCtx) - NOTE_ROOM;
    if (content.length > max) {
      const cut = content.lastIndexOf('\n', max);
      const shown = cut > 0 ? content.slice(0, cut) : content.slice(0, max);
      const shownLines = shown.split('\n').length;
      const last = start + shownLines;
      const total = lineCount(lines.join('\n'));
      return {
        content: `${shown}\n[Lines ${start + 1}–${last} of ${total} shown. Read the rest with offset=${last + 1}.]`,
        structuredContent: { lines: shownLines },
      };
    }
    // For the window's line: « Lu a.ts · 3 lignes ».
    return { content, structuredContent: { lines: lineCount(content) } };
  },
};
