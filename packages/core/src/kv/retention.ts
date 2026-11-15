/**
 * The KV states under a disk budget (spec §7: evict before writing, never
 * the active state, a budget taken from the free space). A state weighs
 * 20 to 100 KB a token and more — gigabytes for a long conversation — so
 * room is made BEFORE a state is written, from what it will weigh. The
 * least recently used go first (a save or a restore dates the slot file);
 * evicting costs a re-read, announced, never a message.
 */

import { readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const GiB = 1024 ** 3;

export interface KvEntry {
  kind: 'state' | 'seed';
  /** A state's id, or a seed's key. */
  id: string;
  bytes: number;
  usedAt: number;
}

export interface KvUsage {
  totalBytes: number;
  entries: KvEntry[];
}

export interface RetentionReport {
  totalBytes: number;
  budgetBytes: number;
  /** State ids, and seeds as `seed:<key>`. */
  evicted: string[];
  /** The states that may not be evicted are over the budget on their own. */
  overBudget: boolean;
}

/** A state that cannot fit even in an empty folder: its save is refused aloud, never dropped in silence. */
export class KvBudgetTooSmallError extends Error {
  constructor(
    readonly needBytes: number,
    readonly budgetBytes: number,
  ) {
    super(`A memory of ${needBytes} bytes does not fit the disk budget of ${budgetBytes} bytes.`);
    this.name = 'KvBudgetTooSmallError';
  }
}

/** 20 GiB, never more than a quarter of the free space. */
export function defaultBudgetBytes(freeBytes: number): number {
  return Math.min(20 * GiB, Math.floor(freeBytes / 4));
}

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
    const seed = /^seed-([0-9a-f]{32})\.slot$/.exec(name);
    const found = await stat(join(dir, name)).catch(() => null);
    if (!found?.isFile()) continue;
    entries.push({
      kind: seed ? 'seed' : 'state',
      id: seed ? seed[1]! : name.slice(0, -'.slot'.length),
      bytes: found.size,
      usedAt: found.mtimeMs,
    });
  }
  return { totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), entries };
}

/** The note a state let go leaves behind: when, and under which budget — what its re-read will say. */
export interface EvictionNote {
  at: string;
  budgetBytes: number;
  /** Released by the person (Settings, Engine and memory), not by the budget. */
  byPerson?: true;
}

async function evict(dir: string, entry: KvEntry, budgetBytes: number): Promise<void> {
  if (entry.kind === 'seed') {
    await rm(join(dir, `seed-${entry.id}.slot`), { force: true });
    await rm(join(dir, 'seeds', `${entry.id}.manifest.json`), { force: true });
  } else {
    await rm(join(dir, `${entry.id}.slot`), { force: true });
    await rm(join(dir, `${entry.id}.manifest.json`), { force: true });
    const note: EvictionNote = { at: new Date().toISOString(), budgetBytes };
    await writeFile(join(dir, `${entry.id}.evicted.json`), JSON.stringify(note)).catch(() => undefined);
  }
}

/**
 * Makes room for `needBytes` more under `budgetBytes`, evicting the least
 * recently used states and seeds — never one of `keep` (the state being
 * saved, the one about to be restored). `replacing`: the state the write
 * replaces — its old file goes when the new one is written, so it does not
 * count beside it.
 */
export async function enforceRetention(
  dir: string,
  budgetBytes: number,
  keep: readonly string[],
  needBytes = 0,
  replacing?: string,
): Promise<RetentionReport> {
  if (needBytes > budgetBytes) throw new KvBudgetTooSmallError(needBytes, budgetBytes);
  const usage = await kvUsage(dir);
  const replaced = usage.entries.find((entry) => entry.kind === 'state' && entry.id === replacing)?.bytes ?? 0;
  let total = usage.totalBytes - replaced;
  const evicted: string[] = [];
  const candidates = usage.entries
    .filter((entry) => entry.kind === 'seed' || !keep.includes(entry.id))
    .sort((a, b) => a.usedAt - b.usedAt);
  for (const entry of candidates) {
    if (total + needBytes <= budgetBytes) break;
    await evict(dir, entry, budgetBytes);
    total -= entry.bytes;
    evicted.push(entry.kind === 'seed' ? `seed:${entry.id}` : entry.id);
  }
  return { totalBytes: total, budgetBytes, evicted, overBudget: total + needBytes > budgetBytes };
}
