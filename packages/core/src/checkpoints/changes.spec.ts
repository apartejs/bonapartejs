/**
 * The « Changements » pane's applied files (task 6.4): what the conversation
 * changed and still stands, each with its text before the conversation first
 * wrote it and its text now — what the diff view draws.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appliedChanges } from './changes.js';
import { CheckpointStore } from './store.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-changes-'));
  dirs.push(dir);
  return dir;
}

describe('the applied changes of a conversation', () => {
  it('each file once: its text before the conversation, its text now; a created file has no before', async () => {
    const store = new CheckpointStore(await temp());
    const repo = await temp();
    const edited = join(repo, 'notes.txt');
    const created = join(repo, 'new.txt');
    await writeFile(edited, 'first\n');
    for (const [turn, path, display, text] of [
      ['t1', edited, 'notes.txt', 'second\n'],
      ['t2', edited, 'notes.txt', 'third\n'],
      ['t2', created, 'new.txt', 'fresh\n'],
    ] as const) {
      await store.before('c1', turn, path, display);
      await writeFile(path, text);
      await store.after('c1', turn, path);
    }
    expect(await appliedChanges(store, 'c1')).toEqual([
      { path: edited, display: 'notes.txt', created: false, before: 'first\n', after: 'third\n' },
      { path: created, display: 'new.txt', created: true, before: null, after: 'fresh\n' },
    ]);
  });

  it('a file too big, or not text, is listed without its texts', async () => {
    const store = new CheckpointStore(await temp());
    const repo = await temp();
    const image = join(repo, 'logo.png');
    await store.before('c1', 't1', image, 'logo.png');
    await writeFile(image, Buffer.from([0x89, 0x50, 0x00, 0x01]));
    await store.after('c1', 't1', image);
    expect(await appliedChanges(store, 'c1')).toEqual([
      { path: image, display: 'logo.png', created: true, before: null, after: null, binary: true },
    ]);
  });
});
