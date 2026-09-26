/**
 * Retention of saved KV states (P2.2, D-20). They live in the slots folder
 * — the server's `--slot-save-path` — and they are big: 100 KB a token and
 * more, so a long conversation is gigabytes. They are kept under a budget:
 * the least recently used go first (a save or a restore is a use: it sets
 * the slot file's date), the kept ones — the active conversation — never,
 * and a kept state that alone exceeds the budget is reported, not deleted.
 *
 * A KV state is only a cache; the log is the truth. Evicting one costs an
 * announced re-prefill the next time, never a message.
 */

import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface KvEntry {
  kind: 'conversation' | 'seed';
  /** The conversation id, or the seed's key. */
  id: string;
  bytes: number;
  /** Last save or restore (the slot file's date). */
  usedAt: number;
}

export interface KvUsage {
  totalBytes: number;
  entries: KvEntry[];
}

export interface RetentionReport {
  totalBytes: number;
  budgetBytes: number;
  /** Conversation ids, and seeds as `seed:<key>`. */
  evicted: string[];
  /** What is left still exceeds the budget: kept states alone are larger than it. */
  overBudget: boolean;
}

/** The saved states in the folder: conversations (`<id>.slot`) and seeds (`seed-<key>.slot`). */
export async function kvUsage(dir: string): Promise<KvUsage> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { totalBytes: 0, entries: [] };
  }
  const entries: KvEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.slot')) continue;
    const base = name.slice(0, -'.slot'.length);
    try {
      const file = await stat(join(dir, name));
      if (!file.isFile()) continue;
      entries.push({
        kind: base.startsWith('seed-') ? 'seed' : 'conversation',
        id: base.startsWith('seed-') ? base.slice('seed-'.length) : base,
        bytes: file.size,
        usedAt: file.mtimeMs,
      });
    } catch {
      // gone between the listing and the stat: nothing to count
    }
  }
  return { totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), entries };
}

async function evict(dir: string, entry: KvEntry): Promise<void> {
  if (entry.kind === 'seed') {
    await rm(join(dir, `seed-${entry.id}.slot`), { force: true });
    await rm(join(dir, 'seeds', `${entry.id}.manifest.json`), { force: true });
  } else {
    await rm(join(dir, `${entry.id}.slot`), { force: true });
    await rm(join(dir, `${entry.id}.manifest.json`), { force: true });
  }
}

/**
 * Brings the folder under `budgetBytes`, least recently used first, never
 * touching the conversations named in `keep`.
 */
export async function enforceRetention(dir: string, budgetBytes: number, keep: string[]): Promise<RetentionReport> {
  const usage = await kvUsage(dir);
  let total = usage.totalBytes;
  const evicted: string[] = [];
  const candidates = usage.entries
    .filter((entry) => !(entry.kind === 'conversation' && keep.includes(entry.id)))
    .sort((a, b) => a.usedAt - b.usedAt);
  for (const entry of candidates) {
    if (total <= budgetBytes) break;
    await evict(dir, entry);
    total -= entry.bytes;
    evicted.push(entry.kind === 'seed' ? `seed:${entry.id}` : entry.id);
  }
  return { totalBytes: total, budgetBytes, evicted, overBudget: total > budgetBytes };
}
