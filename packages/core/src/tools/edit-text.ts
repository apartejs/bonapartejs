/**
 * The one place edit_file decides what it replaces — the tool and the approval's preview alike (audit 2026-11-21,
 * D4). A model writes `\n` where a file checked out on Windows says `\r\n`: old_string matches whatever the line
 * endings, and what is written takes the file's own. Nothing found, the result says how near the nearest text is.
 */

export type EditMatch =
  | { ok: true; after: string }
  | { ok: false; reason: 'not-found'; near?: NearMatch }
  | { ok: false; reason: 'ambiguous'; occurrences: number; lines: number[] };

/** Where the text nearly stands: the same words with other whitespace, or the closest line. */
export type NearMatch = { kind: 'whitespace'; line: number } | { kind: 'closest'; line: number; likeness: number; text: string };

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The line (from 1) an offset of the text is on. */
function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let at = content.indexOf('\n'); at !== -1 && at < offset; at = content.indexOf('\n', at + 1)) line++;
  return line;
}

/** The ending most of the file's lines have. */
function fileEnding(content: string): '\r\n' | '\n' {
  const crlf = content.split('\r\n').length - 1;
  const lf = content.split('\n').length - 1 - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

/**
 * What write_file writes over a file: a CRLF file rewritten with LF alone (what a model writes) keeps its CRLF, so
 * that the change is the lines changed, not the whole file. A new file, or one given its own endings, as it comes.
 */
export function keepEndings(before: string | null, content: string): string {
  if (before === null || content.includes('\r\n') || fileEnding(before) !== '\r\n') return content;
  return content.replace(/\n/g, '\r\n');
}

export function applyEdit(content: string, oldString: string, newString: string): EditMatch {
  // Each line break of old_string matches either ending; the rest, exactly.
  const pattern = new RegExp(oldString.split(/\r?\n/).map(escape).join('\\r?\\n'), 'g');
  const found = [...content.matchAll(pattern)];
  if (found.length > 1) return { ok: false, reason: 'ambiguous', occurrences: found.length, lines: found.map((one) => lineAt(content, one.index)) };
  const match = found[0];
  if (!match) {
    const near = nearMatch(content, oldString);
    return { ok: false, reason: 'not-found', ...(near ? { near } : {}) };
  }
  const matched = match[0];
  const ending = matched.includes('\r\n') ? '\r\n' : matched.includes('\n') ? '\n' : fileEnding(content);
  const replacement = newString.replace(/\r?\n/g, ending);
  return { ok: true, after: content.slice(0, match.index) + replacement + content.slice(match.index + matched.length) };
}

/** Past this, the closest line is not looked for: the file is too long to compare line by line here. */
const MAX_LINES_COMPARED = 20_000;
/** Below this likeness, a line is no near match. */
const MIN_LIKENESS = 0.6;

function nearMatch(content: string, oldString: string): NearMatch | undefined {
  const words = oldString.split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const spaced = new RegExp(words.map(escape).join('\\s*')).exec(content);
  if (spaced) return { kind: 'whitespace', line: lineAt(content, spaced.index) };
  const first = oldString.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!first) return undefined;
  const lines = content.split(/\r?\n/);
  if (lines.length > MAX_LINES_COMPARED) return undefined;
  let best: { line: number; likeness: number; text: string } | undefined;
  lines.forEach((text, index) => {
    const likeness = dice(first, text.trim());
    if (likeness >= MIN_LIKENESS && (!best || likeness > best.likeness)) best = { line: index + 1, likeness, text: text.trim() };
  });
  return best ? { kind: 'closest', ...best } : undefined;
}

/** How alike two strings are, from 0 to 1: the pairs of letters they share (Dice's coefficient). */
function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const pair = a.slice(i, i + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const pair = b.slice(i, i + 2);
    const left = pairs.get(pair) ?? 0;
    if (left > 0) {
      shared++;
      pairs.set(pair, left - 1);
    }
  }
  return (2 * shared) / (a.length - 1 + b.length - 1);
}

/** What the model reads when edit_file cannot place old_string: what to do next, and where the text nearly is. */
export function editFailure(path: string, failed: Exclude<EditMatch, { ok: true }>): string {
  if (failed.reason === 'ambiguous') {
    const shown = failed.lines.slice(0, 10).join(', ');
    return `old_string occurs ${failed.occurrences} times in ${path} (lines ${shown}); the file is unchanged. Add a nearby line or two to old_string so that it occurs only once.`;
  }
  const base = `old_string was not found in ${path}; the file is unchanged. Read the file again and copy the text exactly, indentation included.`;
  const near = failed.near;
  if (!near) return base;
  if (near.kind === 'whitespace') return `${base} The same text with different whitespace (spaces, tabs or indentation) is at line ${near.line}: copy it from there.`;
  const text = near.text.length > 120 ? `${near.text.slice(0, 120)}…` : near.text;
  return `${base} The closest line is line ${near.line} (${Math.round(near.likeness * 100)}% alike): ${JSON.stringify(text)}.`;
}
