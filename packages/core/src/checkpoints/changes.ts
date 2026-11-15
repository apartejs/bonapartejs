/**
 * The « Changements » pane's applied files (task 6.4): what a conversation
 * changed and still stands, each with its text before the conversation first
 * wrote it and its text now. A file too big for a diff, or not text, is
 * listed without its texts.
 */

import { readFile } from 'node:fs/promises';
import type { CheckpointStore } from './store.js';

export interface AppliedChange {
  path: string;
  display: string;
  /** It did not exist before the conversation wrote it. */
  created: boolean;
  /** Its text before the conversation; null when it did not exist, or cannot be shown. */
  before: string | null;
  /** Its text now; null when it is gone, or cannot be shown. */
  after: string | null;
  /** Not text, or too big: no diff. */
  binary?: true;
}

/** Past this, a file is listed without its texts. */
export const DIFF_BYTES = 512 * 1024;

const shown = (bytes: Buffer): string | undefined =>
  bytes.length > DIFF_BYTES || bytes.subarray(0, 8000).includes(0) ? undefined : bytes.toString('utf8');

async function current(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

export async function appliedChanges(store: CheckpointStore, conversationId: string): Promise<AppliedChange[]> {
  const files = await store.files(conversationId);
  return Promise.all(
    files.map(async (file): Promise<AppliedChange> => {
      const original = await store.original(conversationId, file.path);
      const now = await current(file.path);
      const before = original ? shown(original) : null;
      const after = now ? shown(now) : null;
      const base = { path: file.path, display: file.display, created: file.created };
      if (before === undefined || after === undefined) return { ...base, before: null, after: null, binary: true };
      return { ...base, before, after };
    }),
  );
}
