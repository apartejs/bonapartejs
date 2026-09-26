/**
 * Saved KV states live on disk, and they are big — 100 KB a token and
 * more: a 30 000-token conversation is gigabytes. Retention keeps them
 * under a budget (P2.2, D-20): the least recently used go first, the
 * active conversation never, and a state that alone exceeds the budget is
 * reported rather than silently deleted. The KV state is only a cache —
 * the log is the truth — so an evicted conversation costs an announced
 * re-prefill, never a message.
 */

import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { enforceRetention, kvUsage } from './retention.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

const MB = 1024 * 1024;

/** A conversation state (slot + manifest) or a seed, of `mb` megabytes, last used `minutesAgo`. */
async function state(dir: string, name: string, mb: number, minutesAgo: number): Promise<void> {
  const seed = name.startsWith('seed-');
  const slot = join(dir, `${name}.slot`);
  await writeFile(slot, Buffer.alloc(mb * MB));
  const when = new Date(Date.now() - minutesAgo * 60_000);
  await utimes(slot, when, when);
  if (seed) {
    await mkdir(join(dir, 'seeds'), { recursive: true });
    await writeFile(join(dir, 'seeds', `${name.slice(5)}.manifest.json`), '{}');
  } else {
    await writeFile(join(dir, `${name}.manifest.json`), '{}');
  }
}

async function kvDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-retention-'));
  dirs.push(dir);
  return dir;
}

describe('kvUsage — what the saved states take', () => {
  it('counts conversations and seeds, their bytes and when they were last used', async () => {
    const dir = await kvDir();
    await state(dir, 'conv-a', 2, 10);
    await state(dir, 'seed-abc', 1, 5);

    const usage = await kvUsage(dir);

    expect(usage.totalBytes).toBe(3 * MB);
    expect(usage.entries.map((e) => [e.kind, e.id, e.bytes])).toEqual(
      expect.arrayContaining([
        ['conversation', 'conv-a', 2 * MB],
        ['seed', 'abc', 1 * MB],
      ]),
    );
  });

  it('an empty or absent folder is zero, not an error', async () => {
    expect((await kvUsage(join(tmpdir(), 'bp-none-' + Date.now()))).totalBytes).toBe(0);
  });
});

describe('enforceRetention — under the budget, least recently used first', () => {
  it('evicts the oldest until the rest fits, slot and manifest together', async () => {
    const dir = await kvDir();
    await state(dir, 'conv-old', 4, 300);
    await state(dir, 'conv-mid', 4, 60);
    await state(dir, 'conv-new', 4, 1);

    const report = await enforceRetention(dir, 9 * MB, []);

    expect(report.evicted).toEqual(['conv-old']);
    expect(report.totalBytes).toBe(8 * MB);
    expect(report.overBudget).toBe(false);
    expect(existsSync(join(dir, 'conv-old.slot'))).toBe(false);
    expect(existsSync(join(dir, 'conv-old.manifest.json'))).toBe(false);
    expect(existsSync(join(dir, 'conv-mid.slot'))).toBe(true);
  });

  it('never evicts a kept conversation — even the oldest', async () => {
    const dir = await kvDir();
    await state(dir, 'conv-active', 4, 500);
    await state(dir, 'conv-b', 4, 10);

    const report = await enforceRetention(dir, 5 * MB, ['conv-active']);

    expect(report.evicted).toEqual(['conv-b']);
    expect(existsSync(join(dir, 'conv-active.slot'))).toBe(true);
  });

  it('seeds are evicted like the rest, with their manifest', async () => {
    const dir = await kvDir();
    await state(dir, 'seed-old', 3, 400);
    await state(dir, 'conv-a', 3, 1);

    const report = await enforceRetention(dir, 4 * MB, []);

    expect(report.evicted).toEqual(['seed:old']);
    expect(existsSync(join(dir, 'seeds', 'old.manifest.json'))).toBe(false);
  });

  it('a kept state alone over the budget is reported, not deleted', async () => {
    const dir = await kvDir();
    await state(dir, 'conv-huge', 8, 1);

    const report = await enforceRetention(dir, 5 * MB, ['conv-huge']);

    expect(report.overBudget).toBe(true);
    expect(report.evicted).toEqual([]);
    expect(existsSync(join(dir, 'conv-huge.slot'))).toBe(true);
  });

  it('under the budget, nothing moves', async () => {
    const dir = await kvDir();
    await state(dir, 'conv-a', 1, 1);
    expect((await enforceRetention(dir, 10 * MB, [])).evicted).toEqual([]);
  });
});
