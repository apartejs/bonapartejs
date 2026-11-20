/**
 * Project instructions — the file every harness reads at a repository's
 * root, so the agent follows the repository's conventions.
 *
 * Per root, the first found of `.bonaparte/instructions.md`, `AGENTS.md`,
 * `CLAUDE.md`. A file made only of `@file` import lines (a `CLAUDE.md` that
 * says `@AGENTS.md`) is followed one level, inside its root; each file read
 * is labelled by its own path, so that a cut can name the file to read on.
 *
 * The text read is whole. It is cut when it is frozen into a prompt, to the
 * context it is frozen for (`cutInstructions`, about 12 % of it: audit
 * 2026-11-21, I2), the cut naming the file and the line to read on from. A
 * later change is announced by an appended note; a change of the context
 * alone is none.
 */

import { readFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, isAbsolute, join } from 'node:path';
import { realLocation } from './paths.js';

export const INSTRUCTION_FILES = ['.bonaparte/instructions.md', 'AGENTS.md', 'CLAUDE.md'] as const;

/** The most a prompt takes of them, whatever the context: about 8 000 tokens. */
export const MAX_INSTRUCTIONS_CHARS = 32_000;
/** Their share of the context: about 1 000 tokens at 8 k. */
export const INSTRUCTIONS_SHARE = 0.12;
/** Characters a token of English prose, about. */
const CHARS_PER_TOKEN = 4;
/** What is read of them at most: a file larger is no instructions anyone keeps in a prompt. */
const MAX_READ_CHARS = 1_000_000;

export interface ProjectInstructions {
  /** What goes into the prompt, each file labelled; whole — cut when frozen (`cutInstructions`). */
  text: string;
  /** Files found, relative to their root (prefixed by the root's name when there are several). */
  sources: string[];
}

/** Inside the root where it really stands: a link that takes it elsewhere is outside (security rule 6). */
function inside(root: string, path: string): boolean {
  const rel = relative(realLocation(resolve(root)), realLocation(resolve(path)));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function readIfFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** A path as the model reads it: relative to its root, with forward slashes. */
function shown(root: string, file: string): string {
  return relative(resolve(root), resolve(file)).replace(/\\/g, '/');
}

/**
 * A file whose non-empty lines are all `@path` imports is replaced by what it imports (one level, inside the
 * root), each part under its own path; any other file is itself.
 */
async function partsOf(root: string, file: string, content: string): Promise<{ path: string; content: string }[]> {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  if (lines.length === 0 || !lines.every((line) => /^@\S+$/.test(line))) return [{ path: shown(root, file), content }];
  const parts: { path: string; content: string }[] = [];
  for (const line of lines) {
    const target = resolve(dirname(file), line.slice(1));
    if (!inside(root, target)) continue;
    const imported = await readIfFile(target);
    if (imported !== undefined) parts.push({ path: shown(root, target), content: imported.trimEnd() });
  }
  return parts.length > 0 ? parts : [{ path: shown(root, file), content }];
}

export async function readProjectInstructions(roots: string[]): Promise<ProjectInstructions | undefined> {
  const found: { label: string; content: string }[] = [];
  const sources: string[] = [];
  for (const [index, root] of roots.entries()) {
    for (const name of INSTRUCTION_FILES) {
      const file = join(root, name);
      if (!inside(root, file)) continue;
      const content = await readIfFile(file);
      if (content === undefined || content.trim() === '') continue;
      const prefix = roots.length > 1 ? `${basename(resolve(root))}/` : '';
      // Each labelled by a path read_file opens: relative paths resolve from the first folder; another folder's file
      // is named whole (review of round 2, 6). Its blank lines at the start kept: a cut counts the file's own lines.
      const label = (path: string): string => (index === 0 ? path : resolve(root, path).replace(/\\/g, '/'));
      for (const part of await partsOf(root, file, content)) found.push({ label: label(part.path), content: part.content.trimEnd() });
      sources.push(`${prefix}${name}`);
      break;
    }
  }
  if (found.length === 0) return undefined;
  const text = found.map(({ label, content }) => `(from ${label})\n${content}`).join('\n\n');
  return { text: text.slice(0, MAX_READ_CHARS), sources };
}

/** The context assumed when it is not known (an engine elsewhere that does not say it): the smallest a load takes. */
export const UNKNOWN_CONTEXT = 8192;

/**
 * What the instructions may take of a prompt for a context of `window` tokens (characters). A context not known
 * is taken as a small one: an infinite one would freeze the most, more than a small context holds (review of round 2, 3).
 */
export function instructionsBudget(window: number): number {
  const context = Number.isFinite(window) && window > 0 ? window : UNKNOWN_CONTEXT;
  return Math.min(MAX_INSTRUCTIONS_CHARS, Math.floor(context * INSTRUCTIONS_SHARE) * CHARS_PER_TOKEN);
}

/** Where each labelled file starts in the text: its label, and where its content begins. */
function labels(text: string): { label: string; at: number; content: number }[] {
  const found: { label: string; at: number; content: number }[] = [];
  const pattern = /(?:^|\n\n)\(from ([^)\n]+)\)\n/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const at = match.index + (match[0].startsWith('\n') ? 2 : 0);
    found.push({ label: match[1]!, at, content: match.index + match[0].length });
  }
  return found;
}

/**
 * The instructions as a prompt of `maxChars` takes them: whole when they fit; else cut after a whole line, a note
 * naming the file and the line to read on from with read_file, and the files past the cut named.
 */
export function cutInstructions(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const parts = labels(text);
  // The notes take some room of their own: the cut is placed before it.
  const later = (from: number): string[] => parts.filter((part) => part.at >= from).map((part) => part.label);
  for (let room = maxChars - 160; room > 0; room -= 80) {
    const end = text.lastIndexOf('\n', room);
    if (end <= 0) break;
    const part = parts.findLast((one) => one.content <= end);
    const notShown = later(end);
    let note: string;
    if (part) {
      const line = text.slice(part.content, end).split('\n').length;
      note = `[${part.label} is cut after line ${line}: read_file ${part.label} with offset ${line + 1} for the rest]`;
    } else {
      note = '[the instructions are cut here]';
    }
    if (notShown.length > 0) note += `\n[Not shown: ${notShown.join(', ')} — read with read_file when you need them]`;
    const cut = `${text.slice(0, end)}\n${note}`;
    if (cut.length <= maxChars) return cut;
  }
  return text.slice(0, Math.max(0, maxChars));
}

/** A label line, and the note the cut of the first version wrote. */
const LABEL = /^\(from [^)\n]+\)$/gm;
const OLD_CUT = '\n\n[instructions cut here: the file continues — read it with read_file when you need the rest]';

/**
 * The instructions a conversation was told (`stored`) are those of now: the same text — whatever labels it bore
 * (an imported file was labelled by the file that imported it) or, frozen by the first version, cut at 16 000
 * characters with its note, a start of them. A change of the context alone changes nothing to tell.
 */
export function sameInstructions(stored: string, current: string): boolean {
  if (stored === current) return true;
  if (stored === '' || current === '') return false;
  const bare = (text: string): string => text.replace(LABEL, '');
  if (stored.endsWith(OLD_CUT)) return bare(current).startsWith(bare(stored.slice(0, -OLD_CUT.length)));
  return bare(stored) === bare(current);
}
