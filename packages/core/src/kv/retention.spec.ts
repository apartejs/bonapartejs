/**
 * The KV states take gigabytes: they live under a disk budget. Room is made
 * BEFORE a state is written, from what it will weigh; the least recently
 * used go first; the state being saved and the one about to be restored are
 * never evicted; a state bigger than the whole budget is refused aloud.
 * Evicting costs a re-read, announced — never a message.
 */

import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultBudgetBytes, enforceRetention, KvBudgetTooSmallError, kvUsage } from './retention.js';

const GiB = 1024 ** 3;
let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-retention-'));
  dirs.push(dir);
  return dir;
}

/** A saved state of `bytes`, last used `minutesAgo`. */
async function state(dir: string, id: string, bytes: number, minutesAgo: number): Promise<void> {
  await writeFile(join(dir, `${id}.slot`), Buffer.alloc(bytes));
  await writeFile(join(dir, `${id}.manifest.json`), '{}');
  const at = new Date(Date.now() - minutesAgo * 60_000);
  await utimes(join(dir, `${id}.slot`), at, at);
}

async function seed(dir: string, key: string, bytes: number, minutesAgo: number): Promise<void> {
  await mkdir(join(dir, 'seeds'), { recursive: true });
  await writeFile(join(dir, `seed-${key}.slot`), Buffer.alloc(bytes));
  await writeFile(join(dir, 'seeds', `${key}.manifest.json`), '{}');
  const at = new Date(Date.now() - minutesAgo * 60_000);
  await utimes(join(dir, `seed-${key}.slot`), at, at);
}

describe('kvUsage', () => {
  it('counts the states and the seeds, their size and their last use', async () => {
    const dir = await folder();
    await state(dir, 'c1_main', 1000, 10);
    await seed(dir, 'a'.repeat(32), 500, 5);
    const usage = await kvUsage(dir);
    expect(usage.totalBytes).toBe(1500);
    expect(usage.entries.map((entry) => `${entry.kind}:${entry.id}`).sort()).toEqual(['seed:' + 'a'.repeat(32), 'state:c1_main']);
  });

  it('is zero for an empty or absent folder, not an error', async () => {
    expect(await kvUsage(join(await folder(), 'none'))).toEqual({ totalBytes: 0, entries: [] });
  });
});

describe('enforceRetention', () => {
  it('makes room before a write: the least recently used go first, slot and manifest together', async () => {
    const dir = await folder();
    await state(dir, 'old', 400, 30);
    await state(dir, 'mid', 400, 20);
    await state(dir, 'new', 400, 10);
    // 1 200 there, 500 to come, 1 500 allowed: one state must go.
    const report = await enforceRetention(dir, 1500, [], 500);
    expect(report.evicted).toEqual(['old']);
    expect((await readdir(dir)).sort()).toEqual(['mid.manifest.json', 'mid.slot', 'new.manifest.json', 'new.slot']);
  });

  it('never evicts the state being saved nor the one about to be restored, even the oldest', async () => {
    const dir = await folder();
    await state(dir, 'active', 400, 60);
    await state(dir, 'next', 400, 50);
    await state(dir, 'other', 400, 10);
    const report = await enforceRetention(dir, 900, ['active', 'next'], 0);
    expect(report.evicted).toEqual(['other']);
  });

  it('does not count twice the state a save replaces: its old file goes when the new one is written', async () => {
    const dir = await folder();
    await state(dir, 'a', 500, 10);
    await state(dir, 'b', 300, 20);
    // a is saved again at 510: once written, the folder holds 810 of the 1 000 allowed.
    const report = await enforceRetention(dir, 1000, ['a'], 510, 'a');
    expect(report).toMatchObject({ evicted: [], overBudget: false });
    expect(await readdir(dir)).toContain('b.slot');
  });

  it('evicts seeds like the rest, with their manifest', async () => {
    const dir = await folder();
    const key = 'b'.repeat(32);
    await seed(dir, key, 400, 40);
    await state(dir, 'c1', 400, 10);
    expect((await enforceRetention(dir, 500, [], 0)).evicted).toEqual([`seed:${key}`]);
    expect(await readdir(join(dir, 'seeds'))).toEqual([]);
  });

  it('refuses aloud a state bigger than the whole budget, before evicting anything', async () => {
    const dir = await folder();
    await state(dir, 'c1', 400, 10);
    await expect(enforceRetention(dir, 1000, [], 2000)).rejects.toBeInstanceOf(KvBudgetTooSmallError);
    expect(await readdir(dir)).toContain('c1.slot');
  });

  it('reports kept states alone over the budget, and deletes none of them', async () => {
    const dir = await folder();
    await state(dir, 'active', 800, 10);
    const report = await enforceRetention(dir, 500, ['active'], 0);
    expect(report).toMatchObject({ evicted: [], overBudget: true });
    expect(await readdir(dir)).toContain('active.slot');
  });

  it('moves nothing under the budget', async () => {
    const dir = await folder();
    await state(dir, 'c1', 400, 10);
    expect(await enforceRetention(dir, 1000, [], 100)).toMatchObject({ evicted: [], overBudget: false });
  });
});

describe('defaultBudgetBytes', () => {
  it('is 20 GiB, never more than a quarter of the free space', () => {
    expect(defaultBudgetBytes(500 * GiB)).toBe(20 * GiB);
    expect(defaultBudgetBytes(40 * GiB)).toBe(10 * GiB);
  });
});
