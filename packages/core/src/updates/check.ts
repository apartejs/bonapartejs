/**
 * What the updates cost (task 13.1, design §7.6): figures, never words — the
 * window says them. The app's own update lives in the main process
 * (electron-updater); llama.cpp's is `core.llamaCpp()`; a model's is an entry
 * of the catalogue that replaces a file the person has.
 */

import { basename } from 'node:path';
import { DEFAULT_PREFILL_TOKENS_PER_SECOND } from '../costs/announce.js';
import type { CatalogueEntry } from '../models/catalogue.js';

export interface ModelUpdate {
  entry: CatalogueEntry;
  /** The file on the disk it replaces (its full path). */
  replaces: string;
}

const nameOf = (path: string): string => basename(path.replace(/\\/g, '/')).toLowerCase();

/**
 * The entries offered as a new version: one of the files they replace is on
 * the disk, their own file is not, and the person did not keep the current one.
 */
export function modelUpdates(
  catalogue: readonly CatalogueEntry[],
  onDisk: readonly string[],
  kept: readonly string[],
): ModelUpdate[] {
  const names = new Map(onDisk.map((path) => [nameOf(path), path]));
  const found: ModelUpdate[] = [];
  for (const entry of catalogue) {
    if (!entry.replaces?.length || kept.includes(entry.id) || names.has(entry.file.toLowerCase())) continue;
    const old = entry.replaces.map((file) => names.get(file.toLowerCase())).find((path) => path !== undefined);
    if (old) found.push({ entry, replaces: old });
  }
  return found;
}

export interface ModelUpdateView {
  id: string;
  name: string;
  file: string;
  bytes: number;
  /** The file it replaces. */
  replaces: string;
  reread: RereadCost;
  downloading: { done: number; total: number | null } | null;
}

/** What can be updated, besides the app (whose update the main process owns). */
export interface UpdatesView {
  llama: { build: string; bytes: number } | null;
  models: ModelUpdateView[];
}

export interface RereadCost {
  conversations: number;
  tokens: number;
  seconds: number;
}

/** The conversations kept in memory for a model, read again one by one once it changes. */
export function rereadCost(tokensEach: readonly number[], prefillTokensPerSecond: number | undefined): RereadCost {
  const tokens = tokensEach.reduce((sum, one) => sum + one, 0);
  const speed = prefillTokensPerSecond ?? DEFAULT_PREFILL_TOKENS_PER_SECOND;
  return { conversations: tokensEach.length, tokens, seconds: Math.ceil(tokens / speed) };
}
