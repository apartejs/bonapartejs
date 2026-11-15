/**
 * What the built-in tools share. An expected failure is a result the model
 * reads and corrects itself from (`refused`), never an exception: the
 * registry turns only the unexpected into a failed result.
 */

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { PathOutsideHomeError, PathOutsidePerimeterError, realLocation, resolveInPerimeter } from '../../project/paths.js';
import type { ToolContext, ToolDef, ToolHandler, ToolOutput } from '../types.js';

export interface BuiltinTool {
  def: ToolDef;
  handler: ToolHandler;
}

export const refused = (content: string): ToolOutput => ({ content, failed: true });

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function field(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined;
}

export function text(input: unknown, key: string): string | undefined {
  const value = field(input, key);
  return typeof value === 'string' ? value : undefined;
}

export function wholeNumber(input: unknown, key: string): number | undefined {
  const value = field(input, key);
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

/** The same place, as Windows compares paths (its names ignore case) or as the system does elsewhere. */
function samePlace(a: string, b: string): boolean {
  return process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
}

/** Where a requested path lands in the perimeter — or the refusal for the model, which names the folders allowed. */
export function inPerimeter(ctx: ToolContext, requested: string): { path: string } | { error: string } {
  try {
    return { path: resolveInPerimeter(ctx.roots, requested) };
  } catch (error) {
    // Outside the project, allowed by the person for this call: written where it was shown. Never
    // outside the home folder without a project, never the network, never a stream.
    if (ctx.granted && error instanceof PathOutsidePerimeterError && !(error instanceof PathOutsideHomeError) && ctx.roots[0]) {
      const absolute = resolve(ctx.roots[0], requested.replace(/\\/g, '/'));
      // Only where the card showed: a link anywhere on the way leads elsewhere, and is refused.
      if (samePlace(realLocation(absolute), absolute)) return { path: absolute };
    }
    return { error: describeError(error) };
  }
}

/** The folder a tool works from: the project's first, or the home folder without a project. */
export function workRoot(ctx: ToolContext): string {
  return ctx.roots[0] ?? homedir();
}

/** Folders never walked: what a build or a package manager made. */
export const SKIPPED_FOLDERS = new Set(['node_modules', '.git', 'dist', 'out', '.nx', '.next', 'target', '__pycache__']);
