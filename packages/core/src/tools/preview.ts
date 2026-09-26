/**
 * What an approval shows (06 §2, must-have): the change, not only the
 * path. An `edit_file` or a `write_file` is previewed as a unified diff
 * against the file on disk — the thing the person is being asked to sign.
 * Plain text: the approval panel renders it as a preformatted block.
 */

import { readFile } from 'node:fs/promises';
import { displayInPerimeter, resolveInPerimeter } from '../project/paths.js';

const CONTEXT = 3;
/** Past this many cells, a line diff costs too much memory: the change is summarised. */
const MAX_DIFF_CELLS = 4_000_000;
/** A preview longer than this is cut: the panel is a decision surface, not a file viewer. */
const MAX_PREVIEW_CHARS = 12_000;

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

type Op = { kind: ' ' | '-' | '+'; line: string };

/** The line edit script from `a` to `b` (longest common subsequence). */
function editScript(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] as number) + 1
          : Math.max(table[(i + 1) * width + j] as number, table[i * width + j + 1] as number);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: ' ', line: a[i] as string });
      i++;
      j++;
    } else if ((table[(i + 1) * width + j] as number) >= (table[i * width + j + 1] as number)) {
      ops.push({ kind: '-', line: a[i++] as string });
    } else {
      ops.push({ kind: '+', line: b[j++] as string });
    }
  }
  while (i < n) ops.push({ kind: '-', line: a[i++] as string });
  while (j < m) ops.push({ kind: '+', line: b[j++] as string });
  return ops;
}

function range(start: number, count: number): string {
  // A zero-length range names the line before it (0 at the very start).
  return count === 1 ? `${start}` : `${start},${count}`;
}

/** A unified diff of two texts, three lines of context, hunks merged when close. */
export function unifiedDiff(oldName: string, newName: string, before: string, after: string): string {
  const a = splitLines(before);
  const b = splitLines(after);
  const head = `--- ${oldName}\n+++ ${newName}`;
  if (a.length * b.length > MAX_DIFF_CELLS) {
    return `${head}\n(rewrites the whole file: ${a.length} lines → ${b.length} lines — too large to show as a diff)`;
  }
  const ops = editScript(a, b);
  const changed = ops.map((op, index) => (op.kind === ' ' ? -1 : index)).filter((index) => index >= 0);
  if (changed.length === 0) return head;

  // Hunks: spans of ops around changes, merged when their contexts touch.
  const spans: [number, number][] = [];
  for (const index of changed) {
    const from = Math.max(0, index - CONTEXT);
    const to = Math.min(ops.length - 1, index + CONTEXT);
    const last = spans.at(-1);
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else spans.push([from, to]);
  }

  const out = [head];
  // Line numbers of each op, in the old and the new text.
  let oldLine = 1;
  let newLine = 1;
  const positions = ops.map((op) => {
    const here = { oldLine, newLine };
    if (op.kind !== '+') oldLine++;
    if (op.kind !== '-') newLine++;
    return here;
  });
  for (const [from, to] of spans) {
    const slice = ops.slice(from, to + 1);
    const oldCount = slice.filter((op) => op.kind !== '+').length;
    const newCount = slice.filter((op) => op.kind !== '-').length;
    const start = positions[from] as { oldLine: number; newLine: number };
    const oldStart = oldCount === 0 ? start.oldLine - 1 : start.oldLine;
    const newStart = newCount === 0 ? start.newLine - 1 : start.newLine;
    out.push(`@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@`);
    for (const op of slice) out.push(`${op.kind}${op.line}`);
  }
  const text = out.join('\n');
  return text.length > MAX_PREVIEW_CHARS
    ? `${text.slice(0, MAX_PREVIEW_CHARS)}\n… (diff cut: ${text.length - MAX_PREVIEW_CHARS} more characters)`
    : text;
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * The preview of a file tool's call, against the file on disk; undefined
 * for another tool, or a path the tool itself will refuse.
 */
export async function previewToolCall(
  tool: string,
  args: Record<string, unknown>,
  roots: string[],
): Promise<string | undefined> {
  if (tool !== 'edit_file' && tool !== 'write_file') return undefined;
  const requested = str(args, 'path');
  if (!requested) return undefined;
  let absolute: string;
  try {
    absolute = resolveInPerimeter(roots, requested);
  } catch {
    return undefined;
  }
  const shown = displayInPerimeter(roots, absolute);
  let current: string | undefined;
  try {
    current = await readFile(absolute, 'utf8');
  } catch {
    current = undefined;
  }

  if (tool === 'write_file') {
    const content = str(args, 'content');
    if (content === undefined) return undefined;
    return current === undefined
      ? unifiedDiff('/dev/null', shown, '', content)
      : unifiedDiff(shown, shown, current, content);
  }

  const oldString = str(args, 'old_string');
  const newString = str(args, 'new_string');
  if (oldString === undefined || newString === undefined) return undefined;
  if (current === undefined) return `${shown} does not exist — the edit will fail.`;
  const occurrences = oldString === '' ? 0 : current.split(oldString).length - 1;
  if (occurrences === 0) return `old_string not found in ${shown} — the edit will fail.`;
  if (occurrences > 1) return `old_string has ${occurrences} occurrences in ${shown} — the edit will fail.`;
  return unifiedDiff(shown, shown, current, current.replace(oldString, () => newString));
}
