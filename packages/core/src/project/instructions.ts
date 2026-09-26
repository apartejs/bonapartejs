/**
 * Project instructions — the file every harness reads at a repository's
 * root, so the agent follows the repository's conventions (06 §2).
 *
 * Per root, the first found of `.bonaparte/instructions.md`, `AGENTS.md`,
 * `CLAUDE.md`. A file made only of `@file` import lines (a `CLAUDE.md` that
 * says `@AGENTS.md`) is followed one level, inside its root. The whole is
 * capped: instructions ride in every prompt, and a local model's context is
 * small. The text is frozen into a conversation's system prompt at its
 * first open; a later change is announced by an appended message.
 */

import { readFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, isAbsolute, join } from 'node:path';

export const INSTRUCTION_FILES = ['.bonaparte/instructions.md', 'AGENTS.md', 'CLAUDE.md'] as const;

/** Characters kept across all roots — about 4 000 tokens. */
export const MAX_INSTRUCTIONS_CHARS = 16_000;

export interface ProjectInstructions {
  /** What goes into the prompt, each file labelled. */
  text: string;
  /** Files read, relative to their root (prefixed by the root's name when there are several). */
  sources: string[];
}

function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function readIfFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** A file whose non-empty lines are all `@path` imports is replaced by what it imports (one level, inside the root). */
async function followImports(root: string, file: string, content: string): Promise<string> {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  if (lines.length === 0 || !lines.every((line) => /^@\S+$/.test(line))) return content;
  const parts: string[] = [];
  for (const line of lines) {
    const target = resolve(dirname(file), line.slice(1));
    if (!inside(root, target)) continue;
    const imported = await readIfFile(target);
    if (imported !== undefined) parts.push(imported.trim());
  }
  return parts.length > 0 ? parts.join('\n\n') : content;
}

export async function readProjectInstructions(roots: string[]): Promise<ProjectInstructions | undefined> {
  const found: { source: string; content: string }[] = [];
  for (const root of roots) {
    for (const name of INSTRUCTION_FILES) {
      const file = join(root, name);
      const content = await readIfFile(file);
      if (content === undefined || content.trim() === '') continue;
      const text = (await followImports(root, file, content)).trim();
      found.push({ source: roots.length > 1 ? `${basename(resolve(root))}/${name}` : name, content: text });
      break;
    }
  }
  if (found.length === 0) return undefined;

  let text = found.map(({ source, content }) => `(from ${source})\n${content}`).join('\n\n');
  if (text.length > MAX_INSTRUCTIONS_CHARS) {
    text =
      `${text.slice(0, MAX_INSTRUCTIONS_CHARS)}\n\n` +
      `[instructions cut here: the file continues — read it with read_file when you need the rest]`;
  }
  return { text, sources: found.map(({ source }) => source) };
}
