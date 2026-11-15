/**
 * What an approval shows: the change, not the path. For `edit_file` and
 * `write_file` the core reads the file, computes the text after, and the
 * unified diff of the two with aparté's own diff (`@aparte/plugin-diff`, its
 * entry for Node: no DOM). The window draws `<aparte-diff>` from the texts;
 * an edit that will fail says why before anyone agrees to it.
 */

import { readFile } from 'node:fs/promises';
import { diffTexts, formatUnifiedDiff } from '@aparte/plugin-diff';

/** Past this many lines × lines, a rewrite is summed up rather than compared line by line. */
const MAX_DIFF_CELLS = 4_000_000;
/** What a diff may weigh in an approval. */
const MAX_PREVIEW_CHARS = 12_000;

export type ToolPreview =
  | { kind: 'diff'; path: string; before: string | null; after: string; diff: string }
  | { kind: 'fails'; reason: 'missing' | 'not-found' | 'ambiguous'; path: string; occurrences?: number };

/** Where a path the model gave lands — null outside the perimeter — and how it is shown. */
export interface PreviewPaths {
  resolve(requested: string): string | null;
  display(absolute: string): string;
}

/** The lines of a text: a last newline closes the last line, it opens none. */
export function lineCount(text: string | null): number {
  if (text === null || text === '') return 0;
  const lines = text.split('\n').length;
  return text.endsWith('\n') ? lines - 1 : lines;
}

export function unifiedDiff(path: string, before: string | null, after: string): string {
  const removed = lineCount(before);
  const added = lineCount(after);
  if (removed * added > MAX_DIFF_CELLS) {
    const count = (n: number): string => n.toLocaleString('en-US');
    return `diff --git a/${path} b/${path}\n(${count(removed)} lines replaced by ${count(added)}: too many to compare line by line)\n`;
  }
  const diff = formatUnifiedDiff(diffTexts(before, after, { path }));
  return diff.length > MAX_PREVIEW_CHARS ? `${diff.slice(0, MAX_PREVIEW_CHARS)}\n(the diff goes on)\n` : diff;
}

function text(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

export async function previewToolCall(call: { name: string; input: unknown }, paths: PreviewPaths): Promise<ToolPreview | undefined> {
  if (call.name !== 'edit_file' && call.name !== 'write_file') return undefined;
  if (typeof call.input !== 'object' || call.input === null) return undefined;
  const input = call.input as Record<string, unknown>;
  const requested = text(input, 'path');
  if (!requested) return undefined;
  const absolute = paths.resolve(requested);
  if (!absolute) return undefined;
  const shown = paths.display(absolute);
  const current = await readFile(absolute, 'utf8').catch(() => null);

  if (call.name === 'write_file') {
    const content = text(input, 'content');
    if (content === undefined) return undefined;
    return { kind: 'diff', path: shown, before: current, after: content, diff: unifiedDiff(shown, current, content) };
  }

  const oldString = text(input, 'old_string');
  const newString = text(input, 'new_string');
  if (oldString === undefined || newString === undefined) return undefined;
  if (current === null) return { kind: 'fails', reason: 'missing', path: shown };
  const occurrences = oldString === '' ? 0 : current.split(oldString).length - 1;
  if (occurrences === 0) return { kind: 'fails', reason: 'not-found', path: shown };
  if (occurrences > 1) return { kind: 'fails', reason: 'ambiguous', path: shown, occurrences };
  const after = current.replace(oldString, () => newString);
  return { kind: 'diff', path: shown, before: current, after, diff: unifiedDiff(shown, current, after) };
}
