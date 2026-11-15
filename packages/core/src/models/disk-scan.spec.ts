/**
 * « Chercher sur tout le disque (plus long) » (Settings, Models — task 5.7):
 * a search that says how far it went, can be cancelled, skips the folders no
 * model lives in (`node_modules`, the system's), and adds the folders where it
 * found models to the folders searched — nothing when it was cancelled.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DiskScan } from './disk-scan.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function tree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bp-disk-'));
  dirs.push(root);
  await mkdir(join(root, 'a', 'b'), { recursive: true });
  await mkdir(join(root, 'c'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'x'), { recursive: true });
  await writeFile(join(root, 'a', 'b', 'gemma.gguf'), 'GGUF');
  await writeFile(join(root, 'c', 'qwen.gguf'), 'GGUF');
  await writeFile(join(root, 'c', 'mmproj-qwen.gguf'), 'GGUF');
  await writeFile(join(root, 'node_modules', 'x', 'fake.gguf'), 'GGUF');
  return root;
}

describe('DiskScan', () => {
  it('finds the folders where models are, says how far it went, and adds them', async () => {
    const root = await tree();
    const added: string[][] = [];
    const scan = new DiskScan(async () => [root], async (folders) => void added.push(folders));
    expect(scan.state()).toMatchObject({ running: false, done: false });
    scan.start();
    expect(scan.state().running).toBe(true);
    await scan.whenDone();
    const state = scan.state();
    expect(state).toMatchObject({ running: false, done: true, cancelled: false });
    expect(state.visited).toBeGreaterThanOrEqual(4);
    expect([...state.folders].sort()).toEqual([join(root, 'a', 'b'), join(root, 'c')].sort());
    expect(added).toEqual([state.folders]);
  });

  it('cancelled, it stops and adds nothing', async () => {
    const root = await tree();
    const added: string[][] = [];
    const scan = new DiskScan(async () => [root], async (folders) => void added.push(folders));
    scan.start();
    scan.cancel();
    await scan.whenDone();
    expect(scan.state()).toMatchObject({ running: false, done: true, cancelled: true });
    expect(added).toEqual([]);
  });

  it('starting it again while it runs does nothing more', async () => {
    const root = await tree();
    let calls = 0;
    const scan = new DiskScan(async () => [root], async () => void (calls += 1));
    scan.start();
    scan.start();
    await scan.whenDone();
    expect(calls).toBe(1);
  });
});
