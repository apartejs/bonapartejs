/**
 * Outils intégrés de l'agent.
 *
 * Principe : un échec ATTENDU (fichier absent, chemin hors projet, motif
 * ambigu) n'est jamais une exception — c'est un résultat `ok: false` avec un
 * message exploitable, que la boucle réinjecte au modèle pour qu'il se
 * corrige. Seul l'imprévu remonte.
 */

import { exec } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { displayPath, resolveInProject } from '../../project/paths.js';
import type { ToolContext, ToolDef, ToolHandler, ToolResult } from '../types.js';

export interface BuiltinTool {
  def: ToolDef;
  handler: ToolHandler;
}

/** Taille max d'un contenu réinjecté au modèle (garde-fou de contexte). */
export const MAX_TOOL_OUTPUT_CHARS = 30_000;

const DEFAULT_SHELL_TIMEOUT_MS = 120_000;
const MAX_SHELL_TIMEOUT_MS = 600_000;
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.nx']);
const MAX_SCANNED_FILES = 2_000;

const ok = (content: string): ToolResult => ({ ok: true, content });
const ko = (content: string): ToolResult => ({ ok: false, content });

function str(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === 'string' ? value : null;
}

function int(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function clamp(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n… [truncated: ${text.length} characters total]`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Résout un chemin ou rend le message d'erreur destiné au modèle. */
function inProject(
  ctx: ToolContext,
  requested: string,
): { path: string } | { error: string } {
  try {
    return { path: resolveInProject(ctx.projectRoot, requested) };
  } catch (error) {
    return { error: describeError(error) };
  }
}

async function walkFiles(root: string, from: string): Promise<string[]> {
  const found: string[] = [];
  const stack = [from];
  while (stack.length > 0 && found.length < MAX_SCANNED_FILES) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) stack.push(full);
      } else if (entry.isFile()) {
        found.push(full);
        if (found.length >= MAX_SCANNED_FILES) break;
      }
    }
  }
  void root;
  return found;
}

// ── read_file ──────────────────────────────────────────────────────────

const readFileTool: BuiltinTool = {
  def: {
    name: 'read_file',
    description:
      "Read a file from the project. Optionally a slice of lines via offset (1-based) and limit.",
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the project root' },
        offset: { type: 'number', description: 'First line (1-based)' },
        limit: { type: 'number', description: 'Number of lines' },
      },
      required: ['path'],
    },
  },
  handler: async (args, ctx) => {
    const requested = str(args, 'path');
    if (!requested) return ko('Missing argument: path.');
    const resolved = inProject(ctx, requested);
    if ('error' in resolved) return ko(resolved.error);

    let content: string;
    try {
      content = await readFile(resolved.path, 'utf8');
    } catch (error) {
      return ko(`Cannot read file: ${requested} (${describeError(error)})`);
    }

    const offset = int(args, 'offset');
    const limit = int(args, 'limit');
    if (offset !== null || limit !== null) {
      const lines = content.split('\n');
      const start = Math.max(0, (offset ?? 1) - 1);
      const end = limit !== null ? start + limit : lines.length;
      content = lines.slice(start, end).join('\n');
    }
    return ok(clamp(content));
  },
};

// ── write_file ─────────────────────────────────────────────────────────

const writeFileTool: BuiltinTool = {
  def: {
    name: 'write_file',
    description:
      'Write a file in the project (overwrites, creates missing directories).',
    effect: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  handler: async (args, ctx) => {
    const requested = str(args, 'path');
    if (!requested) return ko('Missing argument: path.');
    const content = str(args, 'content');
    if (content === null) {
      return ko('Missing or non-string argument: content.');
    }
    const resolved = inProject(ctx, requested);
    if ('error' in resolved) return ko(resolved.error);

    try {
      await mkdir(dirname(resolved.path), { recursive: true });
      await writeFile(resolved.path, content, 'utf8');
    } catch (error) {
      return ko(`Cannot write file: ${requested} (${describeError(error)})`);
    }
    return ok(
      `Wrote: ${displayPath(ctx.projectRoot, resolved.path)} (${content.length} characters)`,
    );
  },
};

// ── edit_file ──────────────────────────────────────────────────────────

const editFileTool: BuiltinTool = {
  def: {
    name: 'edit_file',
    description:
      'Replace a UNIQUE occurrence of old_string with new_string in a file. ' +
      'Give enough context to make the match unambiguous.',
    effect: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  handler: async (args, ctx) => {
    const requested = str(args, 'path');
    const oldString = str(args, 'old_string');
    const newString = str(args, 'new_string');
    if (!requested) return ko('Missing argument: path.');
    if (oldString === null || newString === null) {
      return ko('Arguments old_string and new_string are required.');
    }
    const resolved = inProject(ctx, requested);
    if ('error' in resolved) return ko(resolved.error);

    let content: string;
    try {
      content = await readFile(resolved.path, 'utf8');
    } catch (error) {
      return ko(`Cannot read file: ${requested} (${describeError(error)})`);
    }

    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) {
      return ko(
        `Pattern not found in ${requested}: no occurrence of old_string.`,
      );
    }
    if (occurrences > 1) {
      return ko(
        `Ambiguous pattern in ${requested}: ${occurrences} occurrences. ` +
          'Widen old_string to make it unique. File left unchanged.',
      );
    }

    try {
      await writeFile(resolved.path, content.replace(oldString, newString), 'utf8');
    } catch (error) {
      return ko(`Cannot write file: ${requested} (${describeError(error)})`);
    }
    return ok(`Edited: ${displayPath(ctx.projectRoot, resolved.path)}`);
  },
};

// ── list_dir ───────────────────────────────────────────────────────────

const listDirTool: BuiltinTool = {
  def: {
    name: 'list_dir',
    description: 'List the contents of a project directory (root by default).',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
    },
  },
  handler: async (args, ctx) => {
    const requested = str(args, 'path') ?? '.';
    const resolved = inProject(ctx, requested);
    if ('error' in resolved) return ko(resolved.error);

    try {
      const entries = await readdir(resolved.path, { withFileTypes: true });
      if (entries.length === 0) return ok('(empty directory)');
      const lines = entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort((a, b) => a.localeCompare(b));
      return ok(clamp(lines.join('\n')));
    } catch (error) {
      return ko(`Cannot read directory: ${requested} (${describeError(error)})`);
    }
  },
};

// ── grep_files ─────────────────────────────────────────────────────────

const grepFilesTool: BuiltinTool = {
  def: {
    name: 'grep_files',
    description:
      'Search a regular expression across project files and return matching ' +
      'lines as path:line: content.',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression' },
        path: { type: 'string', description: 'Subdirectory to search' },
      },
      required: ['pattern'],
    },
  },
  handler: async (args, ctx) => {
    const pattern = str(args, 'pattern');
    if (!pattern) return ko('Missing argument: pattern.');

    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (error) {
      return ko(`Invalid regular expression: ${describeError(error)}`);
    }

    const resolved = inProject(ctx, str(args, 'path') ?? '.');
    if ('error' in resolved) return ko(resolved.error);

    const hits: string[] = [];
    for (const file of await walkFiles(ctx.projectRoot, resolved.path)) {
      if (ctx.signal.aborted) break;
      let content: string;
      try {
        content = await readFile(file, 'utf8');
      } catch {
        continue; // binaire ou illisible : ignoré
      }
      const rel = displayPath(ctx.projectRoot, file);
      content.split('\n').forEach((line, index) => {
        if (regex.test(line)) hits.push(`${rel}:${index + 1}: ${line.trim()}`);
      });
    }

    if (hits.length === 0) return ok(`No match for /${pattern}/.`);
    return ok(clamp(hits.join('\n')));
  },
};

// ── run_shell ──────────────────────────────────────────────────────────

const runShellTool: BuiltinTool = {
  def: {
    name: 'run_shell',
    description:
      'Run a shell command at the project root and return its output. ' +
      'Time-bounded; output is truncated when huge.',
    effect: 'execute',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout_ms: { type: 'number', description: 'Max duration in ms (default 120000)' },
      },
      required: ['command'],
    },
  },
  handler: async (args, ctx) => {
    const command = str(args, 'command');
    if (!command || command.trim() === '') {
      return ko('Missing or empty argument: command.');
    }
    const timeout = Math.min(
      int(args, 'timeout_ms') ?? DEFAULT_SHELL_TIMEOUT_MS,
      MAX_SHELL_TIMEOUT_MS,
    );

    return new Promise<ToolResult>((resolve) => {
      exec(
        command,
        {
          cwd: ctx.projectRoot,
          timeout,
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024,
          signal: ctx.signal,
        },
        (error, stdout, stderr) => {
          const output = clamp([stdout, stderr].filter(Boolean).join('').trimEnd());
          if (!error) return resolve(ok(output || '(no output)'));

          const killed = (error as { killed?: boolean }).killed === true;
          if (killed) {
            return resolve(
              ko(`Command aborted: timeout of ${timeout} ms exceeded.\n${output}`),
            );
          }
          const code = (error as { code?: number | string }).code;
          return resolve(
            ko(`Command exited with code ${String(code)}.\n${output}`),
          );
        },
      );
    });
  },
};

export function builtinTools(): BuiltinTool[] {
  return [
    readFileTool,
    writeFileTool,
    editFileTool,
    listDirTool,
    grepFilesTool,
    runShellTool,
  ];
}

export function registerBuiltinTools(register: (tool: BuiltinTool) => void): void {
  for (const tool of builtinTools()) register(tool);
}

export type { ToolHandler };
